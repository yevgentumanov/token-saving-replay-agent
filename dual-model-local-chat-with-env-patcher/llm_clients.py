# llm_clients.py
"""
Unified async LLM client abstraction.
Supports local llama-server (OpenAI-compat) and cloud providers via litellm.
"""

import json
from abc import ABC, abstractmethod
from typing import AsyncIterator

import httpx


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

    async def chat_stream(self, messages: list, **kwargs) -> AsyncIterator[bytes]:
        body = {
            "messages": messages,
            "stream": True,
            "temperature": kwargs.get("temperature", 0.7),
            "max_tokens": kwargs.get("max_tokens", 4096),
        }
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream(
                "POST",
                f"{self._base}/v1/chat/completions",
                json=body,
            ) as response:
                async for chunk in response.aiter_raw():
                    yield chunk

    async def chat_complete(self, messages: list, **kwargs) -> dict:
        body = {
            "messages": messages,
            "stream": False,
            "temperature": kwargs.get("temperature", 0.1),
            "max_tokens": kwargs.get("max_tokens", 1024),
        }
        async with httpx.AsyncClient(timeout=120.0) as client:
            r = await client.post(
                f"{self._base}/v1/chat/completions",
                json=body,
            )
            r.raise_for_status()
            return r.json()

    async def health_check(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                r = await client.get(f"{self._base}/v1/models")
                return r.status_code == 200
        except Exception:
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

    async def chat_stream(self, messages: list, **kwargs) -> AsyncIterator[bytes]:
        import litellm

        response = await litellm.acompletion(
            model=self.model,
            messages=messages,
            stream=True,
            api_key=self.api_key,
            temperature=kwargs.get("temperature", 0.7),
            max_tokens=kwargs.get("max_tokens", 4096),
        )
        async for chunk in response:
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

    async def chat_complete(self, messages: list, **kwargs) -> dict:
        import litellm

        response = await litellm.acompletion(
            model=self.model,
            messages=messages,
            stream=False,
            api_key=self.api_key,
            temperature=kwargs.get("temperature", 0.1),
            max_tokens=kwargs.get("max_tokens", 1024),
        )
        return response.model_dump()

    async def health_check(self) -> bool:
        return bool(self.api_key)


def make_client(provider: str, *, port: int = 8080, model: str = "", api_key: str = "") -> BaseLLMClient:
    """
    Factory that returns the appropriate LLM client.

    provider="local"  → LocalLLMClient(port)
    provider=anything else → CloudLLMClient with litellm model ID.
      If "/" is not in model, the model is prefixed with "{provider}/{model}".
    """
    if provider == "local":
        return LocalLLMClient(port=port)

    # Cloud path
    if "/" not in model:
        full_model = f"{provider}/{model}"
    else:
        full_model = model

    return CloudLLMClient(model=full_model, api_key=api_key)
