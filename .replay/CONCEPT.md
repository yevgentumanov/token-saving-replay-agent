# Project Concept — Token Saving Replay Agent
<!-- KEEPER_VERSION: -1 -->
<!-- IMMUTABLE: This file is read-only for all automated agents and LLMs.
     It may only be changed by an explicit human git commit with a clear justification.
     No tool, script, or LLM output should ever write to this file. -->

---

## Core Identity

**What this project is:**
A local-first, dual-model LLM development assistant that runs entirely on the user's machine.
It launches and manages two local LLM instances simultaneously:
- **Model A** — the Main Thinker: generates responses, code, plans, architecture decisions.
- **Model B** — the Patcher: translates, fixes, and consolidates Model A's output for the user's specific environment.

The system is built around three interlocking ideas:
1. **Inline Patching** — Model B silently adapts Model A's shell commands to the user's actual OS/shell in real time.
2. **Consolidation Pass** — after patching, Model B summarises what changed and injects that summary into Model A's next turn, preserving cross-turn context.
3. **Replay** — the architecture is designed so that entire sessions can eventually be replayed under a new environment or new models with minimal human intervention.

The project is a FastAPI Python backend (port 7860) serving a TypeScript web UI and a VS Code extension. Both clients talk to the same backend. The backend spawns and manages llama-server processes (or delegates to cloud via litellm).

---

## What This Project Is NOT

- **Not a single-model chatbot.** The dual-model split is intentional and load-bearing. Merging Model A and B into one breaks the architecture.
- **Not a cloud-first tool.** Cloud providers (OpenAI, Anthropic, Groq) are optional fallbacks, not the primary use case.
- **Not a generic LLM wrapper.** The Inline Patcher + Consolidation Pass + Replay pipeline is the differentiator. Generic chat is just a transport layer.
- **Not a VS Code-only tool.** The VS Code extension is one client. The web UI (FastAPI + TypeScript) remains a first-class interface.
- **Not a monolith.** The backend (`main.py`, `llm_clients.py`, `consolidation.py`, `keeper.py`) is intentionally modular. Each module has one job.

---

## Non-Negotiable Architectural Principles

These principles may NOT be violated by any implementation decision without explicit Keeper APPROVED verdict AND human git commit:

1. **Dual-model is sacred.**
   Model A and Model B must remain separate instances with separate roles. They may share provider infrastructure (both local, both cloud) but must never be collapsed into a single LLM call.

2. **Backend is the source of truth.**
   All model state, process management, and session logic lives in the Python backend. The frontend (web or VS Code) is a thin client. Business logic does not belong in TypeScript.

3. **Consolidation Pass is protected.**
   `consolidation.py` implements the memory injection mechanism that gives Model A cross-turn awareness. It must not be deleted, disabled by default, or moved to the frontend.

4. **`.replay/` is append-only.**
   Files inside `.replay/` are never deleted or overwritten by automated processes. `CONCEPT.md` is immutable. `chronicle/` checkpoints are permanent records. `internal/` notes are internal only.

5. **llm_clients.py abstraction is inviolable.**
   `BaseLLMClient` / `LocalLLMClient` / `CloudLLMClient` / `make_client()` is the single integration point for all LLM calls. No module may call litellm, httpx, or llama-server directly — all calls route through `make_client()`.

6. **No silent degradation.**
   If Model B is unavailable, the system must clearly signal this to the user. It must NOT silently fall back to skipping patching without informing the user. Warnings are mandatory.

7. **Keeper is advisory, not blocking.**
   Concept Keeper v-1 provides verdicts on architectural decisions. Its REJECTED verdict is a strong signal, not a hard lock. A human can override it with an explicit decision. The Keeper must never be given write access to any project file.

---

## Hard Constraints — Keeper Veto Criteria

The following changes trigger an automatic `REJECTED` verdict with no exceptions.
A human override is still possible, but the Keeper will escalate to `HARD_RESET` on the next review if the change proceeds:

| Proposed Change | Reason for Veto |
|---|---|
| Merging Model A and B into a single LLM call | Destroys the Inline Patcher pipeline |
| Removing or disabling `consolidation.py` | Breaks cross-turn memory injection |
| Moving model process management to the frontend | Violates backend-is-source-of-truth principle |
| Deleting or overwriting `.replay/CONCEPT.md` | Destroys the anchor of the entire memory system |
| Replacing `BaseLLMClient` with direct API calls | Breaks provider abstraction |
| Making the VS Code extension the only supported interface | Abandons the web UI as a first-class client |
| Auto-modifying any file in `.replay/` | Violates append-only contract |
| Removing the `LLAMA_NO_BROWSER` env var check | Re-introduces sidecar pollution |
| Downgrading TypeScript strict mode in extension | Weakens type safety of the extension |

---

## Concept Drift Scale

Used by the Keeper to score how far a proposed change is from this document:

| Score | Meaning |
|---|---|
| 0–2 | Fully aligned — routine implementation, no drift |
| 3–4 | Minor drift — small tradeoff, acceptable with reasoning |
| 5–6 | Moderate drift — requires explicit justification in the git commit |
| 7–8 | High drift — WARNING verdict, human must confirm |
| 9–10 | Severe drift — REJECTED, violates a Non-Negotiable Principle |

---

## Keeper Hard Reset Conditions

The Keeper session must perform a Hard Reset (re-read this file, clear turn history) when ANY of the following is true:

1. `turn_count >= 20` — session is too long, context may have drifted from this document.
2. `concept_drift >= 8` on two consecutive reviews — the conversation is pulling away from the core concept.
3. The Keeper itself outputs `"status": "HARD_RESET"` — self-detected context loss.
4. A manual `POST /api/keeper/reset` is issued by the user.
5. The backend is restarted — every new process is a fresh session.

After a Hard Reset, the Keeper re-reads this file from disk (not from memory) before answering the next review.

---

## Version History

| Version | Date | Change |
|---|---|---|
| -1 | 2026-04-25 | Initial creation. Immutable baseline. |

<!-- END OF CONCEPT.md — Do not append content below this line automatically -->
