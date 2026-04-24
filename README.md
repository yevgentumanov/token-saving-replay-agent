<div align="center">

# ⚡ Token Saving Replay Agent

**Stop feeding your big model the same context over and over.**  
Run a tiny local model beside it. Let it handle the noise.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Python 3.10+](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)](https://python.org)
[![llama.cpp](https://img.shields.io/badge/backend-llama.cpp-4caf50?logo=cplusplus&logoColor=white)](https://github.com/ggml-org/llama.cpp)
[![Stars](https://img.shields.io/github/stars/yevgentumanov/token-saving-replay-agent?style=social)](https://github.com/yevgentumanov/token-saving-replay-agent/stargazers)

</div>

---

## Try it in 60 seconds — Windows

> No Python. No admin rights. No Docker. Just Git and a double-click.

```bat
git clone https://github.com/yevgentumanov/token-saving-replay-agent.git
cd token-saving-replay-agent
start.bat
```

`start.bat` handles everything on first run — then gets out of your way on every run after.

<!-- GIF: terminal showing start.bat first-run progress, then browser opening -->

<details>
<summary>What happens on first run</summary>

| # | Action |
|---|--------|
| 1 | Downloads portable Python 3.12 into `./python/` (~7 MB, one time) |
| 2 | Installs Python dependencies |
| 3 | Downloads `llama-server.exe` b8855 into `./bin/` (direct link, no GitHub API) |
| 4 | File dialog — pick your **main** `.gguf` model |
| 5 | File dialog — pick your **patcher** `.gguf` model |
| 6 | Starts both servers, opens `http://localhost:7860` |

</details>

**On every run after:** skips all setup, opens the app immediately.

**Requirements:** Windows 10/11 · ~500 MB disk · internet on first run only  
**Not needed:** Python · admin rights · Docker · Node · anything else

→ Not on Windows? See the [manual setup guide](./INSTRUCTIONS.md).

---

## The problem

You're guiding a big model (70B, Claude, GPT-4o) through a 30-step task.  
One environment mismatch causes a chain reaction:

```
Model: pip install fastapi
You:   I use uv. Here's the error: [paste]
Model: [re-reads 8,000 tokens of context to suggest: uv add fastapi]
```

The actual fix was 4 words. You burned 8,000 tokens to get there.  
Do this 10 times per session and your context is half garbage before you hit step 15.

---

## The fix

A **small model (1–3B)** runs locally alongside your big one.  
It intercepts every code block after the big model responds and silently fixes mismatches — **without touching the main context at all.**

```
main model  →  thinks hard, stays focused, context stays clean
patcher     →  translates shells, fixes paths, handles errors instantly
```

<!-- SCREENSHOT: UI showing chat response with patcher badge on a code block -->

---

## How it works

### 🗂 Environment Profile
Describe your setup once — shell, OS, package manager, custom rules. It becomes a system prompt injected into every request. The main model knows you use PowerShell + `uv` before you type a word.

### ⚡ Inline Patcher
After each response, the patcher silently checks every command block against your profile. Mismatches are rewritten before you even see them:

| Original | Patched (PowerShell + uv profile) |
|----------|-----------------------------------|
| `pip install fastapi` | `uv add fastapi` |
| `mkdir -p foo/bar` | `New-Item -ItemType Directory foo\bar` |
| `export API_KEY=abc` | `$env:API_KEY = "abc"` |

A small badge marks each patched block. One click to undo.

<!-- SCREENSHOT: code block with green "✓ auto-translated → powershell" badge and undo button -->

### 🔧 Error Popup
Command failed? Click **⚠ Problem?** on the block, paste the stderr, click **Ask patcher**.  
The small model sees only that one block + your error. Fix in ~1 second. Apply with one click.  
Main model context: untouched.

<!-- SCREENSHOT: error popup modal — block content, pasted error, proposed fix, Apply button -->

### 🔢 Step Extractor
Every response is parsed into addressable blocks — `step-1`, `code-block-3`. The foundation for Phase 2.5: Consolidation Pass, which will summarise all patches before sending context back to the main model.

---

## Token savings

| Scenario | Without | With |
|----------|---------|------|
| 1 wrong shell command | ~5,000 tokens (full context resend) | ~300 tokens (patcher call) |
| Error on step 5 of 10 | ~8,000 tokens (re-explain + full context) | ~400 tokens (error popup) |
| 3 env mismatches in one reply | ~15,000 tokens (3× full resend) | ~900 tokens (3× patcher calls) |

**Typical savings on a 30-step technical task: 70–90% of micro-fix tokens.**

---

## Model recommendations

### Main Model (A) — the thinker
Any capable model. Bigger = better reasoning.

| Model | Size | Notes |
|-------|------|-------|
| Qwen3-14B | 14B | Strong reasoning, good instruction following |
| Qwen2.5-32B | 32B | Excellent for complex tasks |
| DeepSeek-R1-14B | 14B | Great for step-by-step technical work |
| Mistral-7B / LLaMA-3.1-8B | 7–8B | Lighter option |

Use Q5 or Q8 quantization for best output quality.

### Patcher Model (B) — the fixer
Small and fast. It handles one block at a time — raw speed matters more than reasoning depth.

| Model | Size | Notes |
|-------|------|-------|
| Qwen3-1.7B | 1.7B | Recommended — fast, understands instructions well |
| Qwen2.5-1.5B | 1.5B | Reliable, widely available |
| SmolLM2-1.7B | 1.7B | Very fast, good for simple translations |
| Llama-3.2-1B | 1B | Lightest option |

> **Thinking models work fine.** The agent sends `/no_think` automatically to skip chain-of-thought overhead. If the model ignores it, the answer is extracted from `reasoning_content` as a fallback.

Both models run locally via llama.cpp. **No API keys. No cloud. No per-token costs.**

---

## Architecture

```
Browser  http://localhost:7860
  └── FastAPI  main.py
        ├── /api/chat/main    ──►  llama-server A  :8080  (main model)
        ├── /api/chat/patcher ──►  llama-server B  :8081  (patcher)
        ├── /api/start         —   spawns llama-server subprocesses
        ├── /api/status        —   health checks every 4 s (/v1/models)
        └── /ws/logs           —   streams llama-server stdout live
```

Frontend: pure HTML + TypeScript. No framework. No build step for end users — compiled `app.js` is committed.

---

## Project status

| Phase | Feature | Status |
|-------|---------|:------:|
| 0 | Launcher — GUI, subprocess management, health check | ✅ |
| 1 | Dual model launcher — Main + Patcher, independent health checks | ✅ |
| 2 | Core — Chat, Environment Profile, Inline Patcher, Error Popup | ✅ |
| — | Thinking model support (`/no_think` + `reasoning_content` fallback) | ✅ |
| — | Portable Windows launcher — true zero-install `start.bat` | ✅ |
| 2.5 | Consolidation Pass — summarise patches before next main model call | 🔜 |
| 3+ | Full Step Extractor, escalation formatter, cross-platform build | 📋 |

---

## Contributing

Issues and PRs are welcome.

- **Bug** → open an issue with the terminal log output
- **Better patcher prompt** → open a PR (actively iterating on this)
- **Model results** — good or bad → share in issues, helps others

---

## 👥 Contributors

<div align="center">

  <a href="https://github.com/yevgentumanov">
    <img src="https://github.com/yevgentumanov.png" width="72" height="72" style="border-radius:50%" alt="yevgentumanov"/>
    <br><b>yevgentumanov</b>
  </a>

  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;

  <a href="https://claude.ai">
    <img src="https://claude.ai/favicon.ico" width="72" height="72" style="border-radius:50%" alt="Claude"/>
    <br><b>Claude</b>
  </a>

  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;

  <a href="https://x.ai">
    <img src="https://x.ai/favicon.ico" width="72" height="72" style="border-radius:50%" alt="Grok"/>
    <br><b>Grok</b>
  </a>

</div>

---

<div align="center">

Built by [@euusome](https://x.com/euusome) · Apache 2.0

*For people who actually run models locally.*

</div>
