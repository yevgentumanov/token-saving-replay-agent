# Checkpoint 001 — Phase 3.0 Complete: VS Code Extension

**Date:** 2026-04-25
**Branch at checkpoint:** `phase-3.0-extension` → merged into `phase-3.1-memory`
**Git commit:** `98b196f` (Fix Phase 3.0: 4 bugs found in code review)
**Keeper status at checkpoint:** N/A — Keeper not yet initialized (initialized in Phase 3.1)
**Concept drift at checkpoint:** 0 — fully aligned with CONCEPT.md baseline

---

## What Was Built

### New: `extension/` — VS Code Extension

| File | Role |
|---|---|
| `extension/src/extension.ts` | activate/deactivate entry point, all command registration |
| `extension/src/backendManager.ts` | Python sidecar manager: spawn, stop (race-condition-free), status polling |
| `extension/src/statusBar.ts` | Live `● A  ● B  ⚡` health indicator in VS Code status bar |
| `extension/src/chatPanel.ts` | WebviewPanel wrapping existing Chat UI via iframe |
| `extension/src/completionProvider.ts` | InlineCompletionItemProvider: debounced FIM via Model B |
| `extension/package.json` | Extension manifest: commands, keybindings, configuration schema |
| `extension/tsconfig.json` | TypeScript config (commonjs, ES2020, strict) |

### Modified: `main.py`
- Added `CORSMiddleware` for `vscode-webview://` and `localhost` origins
- Added `LLAMA_NO_BROWSER` env var check — suppresses `webbrowser.open()` when running as VS Code sidecar

### Modified: `static/app.ts`
- Added `IS_VSCODE` detection via `?vscode=1` query param
- Hidden `window.open` buttons (chatA/chatB) in webview iframe mode

---

## Architectural Decisions Made

| Decision | Rationale |
|---|---|
| iframe approach for Chat Panel | Reuses 100% of existing web UI without duplication |
| Model B for inline completion | Fast, structured output; Model A reserved for reasoning |
| `LLAMA_NO_BROWSER` env var | Clean separation — backend doesn't know it's a sidecar |
| `?vscode=1` query param for webview detection | `acquireVsCodeApi` not available inside cross-origin iframe |
| Node built-in `http` module only | No external npm dependencies in extension |
| Singleton `ChatPanel` | Prevents duplicate webview panels |

---

## Bugs Fixed in Phase 3.0

| Bug | File | Fix |
|---|---|---|
| CSP blocked inline `<script>` and `fetch()` | `chatPanel.ts` | Added `script-src 'unsafe-inline'` and `connect-src` |
| `stop()` race condition — proc killed but never reached | `backendManager.ts` | Capture `proc` ref before nulling `this.proc` |
| Silent crash — no notification if backend dies in <8s | `backendManager.ts` | `showErrorMessage` with "Show Output" action |
| Browser auto-opens when launched as VS Code sidecar | `main.py` | `LLAMA_NO_BROWSER` env var check |

---

## Non-Negotiable Constraints Confirmed

- `consolidation.py` — not touched
- `llm_clients.py` — not touched
- Dual-model architecture — preserved
- `.replay/` — append-only contract respected
- Phase 2.5 behaviour — no regressions

---

## TypeScript Compilation

```
Files compiled: 5
Errors: 0
Output: extension/out/{backendManager,chatPanel,completionProvider,extension,statusBar}.js
```

---

## Open Items Carried Into Phase 3.1

| Item | Priority |
|---|---|
| Manual F5 test in VS Code Extension Development Host | Medium |
| Ring-buffer of open files as completion context | Phase 3.1+ |
| `vsce package` → `.vsix` for marketplace-free install | Low |

---

## Next Phase

**Phase 3.1 — Memory Foundation (Concept Keeper v-1)**
- `keeper.py` + `/api/keeper/*` endpoints
- `.replay/CONCEPT.md` immutable manifesto
- `keeperPanel.ts` in VS Code extension
- Project Chronicle structure established
