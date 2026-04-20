# Token Saving Replay Agent

**The obvious fix everyone keeps ducking under.**

When you use a big LLM (Claude, GPT-4o, Grok, local 70B) to walk through a multi-step task, one small environment mismatch — wrong shell, wrong package manager, wrong OS — causes a chain reaction:

1. Model gives you `pip install fastapi` — you use `uv`
2. You paste the error back — model re-reads the whole context
3. It fixes step 3. Step 7 breaks. Repeat.
4. 15,000 tokens burned. Context polluted. You're tired.

**Token Saving Replay Agent breaks the chain.**

A tiny local model (~1-3B) sits next to the big one. It handles micro-fixes in real time — shell translations, path corrections, missing sudo, version mismatches — without touching the main model's context. The big model stays clean and focused on the hard thinking.

---

## What it does

### Environment Profile
You describe your setup once: shell, OS, Python version, package manager, custom rules. This becomes a system prompt automatically prepended to every request. The main model already knows you use PowerShell + uv before you type a word.

### Inline Patcher
After the main model responds, the patcher model scans every command block. If a command doesn't match your shell or rules, it silently rewrites it — `pip install fastapi` → `uv add fastapi`, `mkdir -p foo/bar` → `mkdir foo\bar -Force`. A small badge appears. You can undo with one click.

### Error Popup
A command failed? Click **⚠ Problem?** on the code block, paste the stderr output, click **Ask patcher**. The small model sees only that one block + your error — not the full conversation. It proposes a fix in ~1 second. Apply it directly.

### Step Extractor
Every response is parsed into addressable blocks — `step-1`, `step-2`, `code-block-3`. This is the foundation for everything above and for Phase 2.5 (Consolidation Pass) coming next.

---

## Token savings

| Scenario | Without Token Saving Replay Agent | With Token Saving Replay Agent |
|----------|-----------------------------------|--------------------------------|
| Wrong shell in 1 block | Re-send full context (~5k tokens) | Patcher call (~300 tokens) |
| Error on step 5 of 10 | Re-explain + full context (~8k tokens) | Error popup (~400 tokens) |
| 3 env mismatches in one reply | 3× full re-sends | 3× parallel patcher calls |

Typical savings on a 30-step technical task: **70–90% of micro-fix tokens**.

---

## How to run

```bash
git clone https://github.com/yevgentumanov/token-saving-replay-agent.git
cd token-saving-replay-agent
pip install -r requirements.txt
python main.py
```

Browser opens at `http://localhost:7860`. No Docker, no installer, no npm.

You need:
- Python 3.10+
- `llama-server` binary from [llama.cpp](https://github.com/ggerganov/llama.cpp/releases)
- One or two `.gguf` model files

For detailed setup, see **[INSTRUCTIONS.md](./INSTRUCTIONS.md)**.

---

## Model recommendations

**Main Model (Model A)** — any capable model:
- Qwen3-14B, Qwen2.5-32B, Mistral-7B, LLaMA-3.1-8B, DeepSeek-R1-14B
- Use Q5 or Q8 quantization for best quality

**Patcher Model (Model B)** — small and fast:
- Qwen2.5-1.5B, SmolLM2-1.7B, Llama-3.2-1B, Qwen3-1.7B
- Speed is the priority, not capability — it only handles one block at a time
- **Thinking models (Qwen3, DeepSeek-R1, etc.) work fine** — Token Saving Replay Agent sends `/no_think` automatically to skip chain-of-thought and get instant answers. If the model ignores it, answers are extracted from `reasoning_content` as a fallback.

Both run locally via llama.cpp. No API keys. No cloud.

---

## Project status

| Phase | Feature | Status |
|-------|---------|--------|
| 0 | Basic launcher — GUI, llama-server subprocess, health check | ✅ Done |
| 1 | Dual model launcher — Main + Patcher, independent health checks | ✅ Done |
| 2 | Core — Chat, Profile, Inline Patcher, Error Popup | ✅ Done |
| — | Thinking model support — `/no_think` + `reasoning_content` fallback | ✅ Done |
| 2.5 | Consolidation Pass — summarise patches before next big-model call | 🔜 Next |
| 3+ | Full Step Extractor, escalation formatter, installers | 📋 Planned |

---

## Architecture

```
Browser (localhost:7860)
  └── FastAPI (main.py)
        ├── /api/chat/main  ──► llama-server A (port 8080) — big model
        ├── /api/chat/patcher ► llama-server B (port 8081) — small patcher
        ├── /api/start       — launches llama-server subprocesses
        ├── /api/status      — health check (pings /v1/models every 4s)
        └── /ws/logs         — streams llama-server stdout in real time
```

Frontend: pure HTML + TypeScript, no framework, no build step for end users. Compiled `app.js` is committed.

---

## License

Apache 2.0 — use, modify, distribute freely.

---

## Author

[@euusome](https://x.com/euusome) — building tools for local LLM users.

---

## Contributing

Issues and PRs welcome. If you run it and something breaks, open an issue with the log console output. If you have a better prompt for the patcher, open a PR — I'm actively iterating on it.

---

*Built for people who actually run models locally.*
