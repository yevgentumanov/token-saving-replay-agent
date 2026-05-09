# Agent Guidance for Token Saving Replay Agent

## Repository Status

- **Current branch**: `main` (ahead of origin/main by 10 commits)
- **Untracked files**: AGENTS.md (this file)
- **Git remotes**: origin/main, remotes/origin/codex/macbook-sharp-edges

## Setup & Execution

- **Start the app**: `python main.py` (runs on http://localhost:7860, opens browser automatically)
- **TypeScript compilation**: After editing `static/app.ts`, run `npx tsc --target ES2020 --lib ES2020,DOM --strict --outDir static static/app.ts`
- **Windows zero-install**: Run `start.bat` (downloads portable Python, sets up environment)
- **macOS**: Double-click `Token Saving Replay Agent.app` or run `./start.sh`
- **Local GGUF models**: Require `llama-server` binary from llama.cpp and GGUF model files
- **Critical path**: Must configure Model A (and optionally Model B) in Launcher tab at http://localhost:7860 before chatting

## Testing

- **Python unit tests**: `pytest tests/`
- **Full alpha test suite** (includes browser e2e): 
  ```bash
  npm install
  npx playwright install chromium
  npm run test:alpha
  ```
  (This runs `python -m unittest discover` followed by `playwright test`)
- **Quick syntax check**: `python -m py_compile main.py llm_clients.py consolidation.py keeper.py portable_launcher.py && node --check static/app.js`

## Configuration

- Runtime state stored in `config.json` (gitignored, created on first Start)
- Reference shape in `config.example.json`
- API keys for cloud providers stored locally in config (never committed)
- Settings persist between sessions via config and browser localStorage
- Profile data (shell, OS, etc.) stored in browser localStorage only, not in config.json

## Architecture Notes

- Two-model system: Model A (main reasoning) + optional Model B (patcher for env-specific fixes)
- Local models use `llama-server` subprocesses; cloud providers use LiteLLM abstraction
- Health checks every 4s via `/v1/models` (local) or `health_check()` (cloud)
- Subprocess logs streamed to browser via WebSocket at `/ws/logs`
- Consolidation pass: Model B summarizes patches to improve Model A context (prevents repetition)
- Keeper concept guardian reviews changes against `.replay/CONCEPT.md` via `/api/keeper/review`

## Development Specifics

- Thinking models: Uses `/no_think` system message; falls back to `reasoning_content` when needed
- Inline patcher: Automatically sends shell command code blocks to Model B for environment-specific fixes
- Error popup: Allows users to paste stderr and get fixes from Model B without replaying whole conversation
- Profile tab: Captures user environment (shell, OS, Python version, package manager) and injects as system prompt on every chat turn
- After editing `static/app.ts`, MUST recompile with `npx tsc --target ES2020 --lib ES2020,DOM --strict --outDir static static/app.ts`
- Key API routes: 
  - `/api/start` - start models
  - `/api/chat/main` - SSE stream from Model A
  - `/api/chat/patcher` - one-shot Model B patcher call
  - `/api/consolidation` - run consolidation pass
  - `/ws/logs` - live llama-server logs