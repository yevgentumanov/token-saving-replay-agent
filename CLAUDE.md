# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

```bash
pip install -r requirements.txt
python main.py
```

The server starts on `http://localhost:7860` and opens a browser automatically.

## TypeScript compilation

`static/app.ts` is the source; `static/app.js` is the compiled output. After editing `app.ts`, recompile:

```bash
npx tsc --target ES2020 --lib ES2020,DOM --strict --outDir static static/app.ts
```

There is no build watch or bundler — just `tsc` directly.

## Architecture

The app is a **two-model LLM launcher + chat UI** built on FastAPI + TypeScript.

**Backend (`main.py`)**
- FastAPI app on port 7860. Manages two optional LLM backends: **Model A** (main) and **Model B** (patcher).
- For local models: spawns `llama-server` subprocesses via `subprocess.Popen`. For cloud providers: uses `litellm` via `CloudLLMClient`.
- Background asyncio tasks health-check both backends every 4 seconds (`/v1/models` for local, or `health_check()` for cloud).
- Log lines from subprocesses are pushed to an `asyncio.Queue` and streamed to the browser over a WebSocket at `/ws/logs`.
- Config is persisted to `config.json`; settings are loaded at startup and updated after each `/api/start`.

**LLM client abstraction (`llm_clients.py`)**
- `BaseLLMClient` defines `chat_stream`, `chat_complete`, and `health_check`.
- `LocalLLMClient` proxies to `llama-server`'s OpenAI-compatible API.
- `CloudLLMClient` wraps `litellm` and normalises streaming output into the same SSE byte format the frontend expects.
- `make_client(provider, ...)` is the factory — always use this from `main.py`.

**Consolidation Pass (`consolidation.py`)**
- After Model B applies inline patches to a turn, `run_consolidation_pass()` asks Model B to produce a structured JSON summary of all changes.
- That summary is injected into the next main-model system prompt so Model A has accurate context.
- Uses `/no_think` system message to suppress chain-of-thought on Qwen3/thinking models.

**Frontend (`static/app.ts`)**
The UI has three tabs: **Launcher**, **Chat**, **Profile**.

- **Launcher tab**: configures and starts/stops Model A and optional Model B. Supports `local` (GGUF via llama-server) and cloud providers (OpenAI, Anthropic, Groq). Settings persist to `localStorage` and `config.json`.
- **Chat tab**: streams responses from Model A via `/api/chat/main` (SSE). After streaming, shell-command code blocks (`bash`, `cmd`, `powershell`, etc.) are automatically sent to Model B via `/api/chat/patcher` for inline translation to the user's shell (Inline Patcher). An error popup lets users paste stderr and get a fix from Model B.
- **Profile tab**: captures user environment (shell, OS, Python version, package manager, custom rules) and injects it as the system prompt on every chat turn.

**Inline Patcher + Consolidation Pass flow (Phase 2 / 2.5):**
1. Model A streams a response.
2. `renderAssistantContent()` identifies command code blocks and calls `runInlinePatch()` on each via Model B.
3. Patched blocks show a badge with an undo button; patches are recorded in `currentTurnPatches`.
4. Once all patch Promises settle, `runConsolidationPass()` sends the patch list to `/api/consolidation`, which calls `run_consolidation_pass()` in `consolidation.py`.
5. The resulting summary is stored in `lastConsolidationSummary` and injected into the system prompt on the next user turn.

**Thinking model handling:** Both frontend (`extractPatcherReply`) and backend (`consolidation.py:_extract_content`) fall back to `reasoning_content` when `content` is empty, extracting JSON from the last code block or last line.
