# llm_clients.py
"""
Unified async LLM client abstraction.
Supports local llama-server (OpenAI-compat) and cloud providers via litellm.
"""

import json
from abc import ABC, abstractmethod
from typing import AsyncIterator

import httpx

from app_logging import get_logger, log_error, log_event, log_warning

logger = get_logger(__name__)


class BaseLLMClient(ABC):
    @abstractmethod
    async def chat_stream(self, messages: list, **kwargs) -> AsyncIterator[bytes]:
        """Yield raw SSE bytes compatible with the existing frontend."""
        ...

    @abstractmethod
    async def chat_complete(self, messages: list, **kwargs) -> dict:
        """Return a single completion as a dict."""
        ...

    @abstractmethod
    async def health_check(self) -> bool:
        """Return True if the backend is reachable and ready."""
        ...


class LocalLLMClient(BaseLLMClient):
    """Proxies to a local llama-server via its OpenAI-compatible API."""

    def __init__(self, port: int):
        self.port = port
        self._base = f"http://127.0.0.1:{port}"
        log_event(logger, "llm.local.init", port=port)

    async def chat_stream(self, messages: list, **kwargs) -> AsyncIterator[bytes]:
        body = {
            "messages": messages,
            "stream": True,
            "temperature": kwargs.get("temperature", 0.7),
            "max_tokens": kwargs.get("max_tokens", 4096),
        }
        log_event(
            logger,
            "llm.local.chat_stream.start",
            port=self.port,
            message_count=len(messages),
            temperature=body["temperature"],
            max_tokens=body["max_tokens"],
        )
        async with httpx.AsyncClient(timeout=None) as client:
            try:
                async with client.stream(
                    "POST",
                    f"{self._base}/v1/chat/completions",
                    json=body,
                ) as response:
                    log_event(logger, "llm.local.chat_stream.response", port=self.port, status_code=response.status_code)
                    response.raise_for_status()
                    chunk_count = 0
                    byte_count = 0
                    async for chunk in response.aiter_raw():
                        chunk_count += 1
                        byte_count += len(chunk)
                        yield chunk
                    log_event(logger, "llm.local.chat_stream.done", port=self.port, chunks=chunk_count, bytes=byte_count)
            except Exception as exc:
                log_error(logger, "llm.local.chat_stream.failed", exc, port=self.port)
                raise

    async def chat_complete(self, messages: list, **kwargs) -> dict:
        body = {
            "messages": messages,
            "stream": False,
            "temperature": kwargs.get("temperature", 0.1),
            "max_tokens": kwargs.get("max_tokens", 1024),
        }
        log_event(
            logger,
            "llm.local.chat_complete.start",
            port=self.port,
            message_count=len(messages),
            temperature=body["temperature"],
            max_tokens=body["max_tokens"],
        )
        async with httpx.AsyncClient(timeout=120.0) as client:
            try:
                r = await client.post(
                    f"{self._base}/v1/chat/completions",
                    json=body,
                )
                log_event(logger, "llm.local.chat_complete.response", port=self.port, status_code=r.status_code)
                r.raise_for_status()
                data = r.json()
                log_event(logger, "llm.local.chat_complete.done", port=self.port)
                return data
            except Exception as exc:
                log_error(logger, "llm.local.chat_complete.failed", exc, port=self.port)
                raise

    async def health_check(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                r = await client.get(f"{self._base}/v1/models")
                healthy = r.status_code == 200
                log_event(logger, "llm.local.health", port=self.port, status_code=r.status_code, healthy=healthy)
                return healthy
        except Exception as exc:
            log_warning(logger, "llm.local.health.failed", port=self.port, error=str(exc))
            return False


class CloudLLMClient(BaseLLMClient):
    """
    Uses litellm to call cloud providers (OpenAI, Anthropic, Groq, etc.).
    Normalises streaming output into the same SSE byte format that the
    frontend already understands (identical to llama-server output).
    """

    def __init__(self, model: str, api_key: str):
        self.model = model
        self.api_key = api_key
        log_event(logger, "llm.cloud.init", model=model, api_key_set=bool(api_key))

    async def chat_stream(self, messages: list, **kwargs) -> AsyncIterator[bytes]:
        import litellm

        log_event(
            logger,
            "llm.cloud.chat_stream.start",
            model=self.model,
            message_count=len(messages),
            temperature=kwargs.get("temperature", 0.7),
            max_tokens=kwargs.get("max_tokens", 4096),
        )
        response = await litellm.acompletion(
            model=self.model,
            messages=messages,
            stream=True,
            api_key=self.api_key,
            temperature=kwargs.get("temperature", 0.7),
            max_tokens=kwargs.get("max_tokens", 4096),
        )
        chunk_count = 0
        async for chunk in response:
            chunk_count += 1
            # Extract the delta content from the litellm chunk
            choices = chunk.choices if hasattr(chunk, "choices") else []
            if choices:
                delta = choices[0].delta if hasattr(choices[0], "delta") else None
                content = delta.content if delta and hasattr(delta, "content") else None
                finish_reason = choices[0].finish_reason if hasattr(choices[0], "finish_reason") else None
            else:
                content = None
                finish_reason = None

            sse_obj = {
                "choices": [
                    {
                        "delta": {"content": content if content is not None else ""},
                        "finish_reason": finish_reason,
                    }
                ]
            }
            yield (f"data: {json.dumps(sse_obj)}\n\n").encode()

        yield b"data: [DONE]\n\n"
        log_event(logger, "llm.cloud.chat_stream.done", model=self.model, chunks=chunk_count)

    async def chat_complete(self, messages: list, **kwargs) -> dict:
        import litellm

        log_event(
            logger,
            "llm.cloud.chat_complete.start",
            model=self.model,
            message_count=len(messages),
            temperature=kwargs.get("temperature", 0.1),
            max_tokens=kwargs.get("max_tokens", 1024),
        )
        response = await litellm.acompletion(
            model=self.model,
            messages=messages,
            stream=False,
            api_key=self.api_key,
            temperature=kwargs.get("temperature", 0.1),
            max_tokens=kwargs.get("max_tokens", 1024),
        )
        data = response.model_dump()
        log_event(logger, "llm.cloud.chat_complete.done", model=self.model)
        return data

    async def health_check(self) -> bool:
        healthy = bool(self.api_key)
        log_event(logger, "llm.cloud.health", model=self.model, healthy=healthy)
        return healthy


def make_client(provider: str, *, port: int = 8080, model: str = "", api_key: str = "") -> BaseLLMClient:
    """
    Factory that returns the appropriate LLM client.

    provider="local"  → LocalLLMClient(port)
    provider=anything else → CloudLLMClient with litellm model ID.
      If "/" is not in model, the model is prefixed with "{provider}/{model}".
    """
    if provider == "local":
        log_event(logger, "llm.make_client", provider=provider, port=port)
        return LocalLLMClient(port=port)

    # Cloud path
    if "/" not in model:
        full_model = f"{provider}/{model}"
    else:
        full_model = model

    log_event(logger, "llm.make_client", provider=provider, model=full_model, api_key_set=bool(api_key))
    return CloudLLMClient(model=full_model, api_key=api_key)
