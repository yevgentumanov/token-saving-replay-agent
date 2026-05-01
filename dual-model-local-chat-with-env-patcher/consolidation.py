"""
Phase 2.5 — Consolidation Pass

After Model B (patcher) applies inline fixes during a single main-model turn,
this module either:
  • runs a full Consolidation Pass (structured JSON summary, all changed_steps)
  • or a lightweight summary (short prose, no step-by-step breakdown)

The choice is driven by smart thresholds:
  - patch count  >= CONSOLIDATION_PATCH_THRESHOLD  → full pass
  - estimated tokens >= CONSOLIDATION_TOKEN_THRESHOLD → full pass
  - below both thresholds → lightweight summary

Either way the result is injected into the next main-model system prompt so
Model A always has accurate context about what the patcher changed.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Literal, Optional

from pydantic import BaseModel

logger = logging.getLogger(__name__)

# ── Tunable thresholds (runtime-patchable via /api/consolidation/config) ─────
MAX_PATCHES_PER_PASS          = 10    # hard cap: never send more than this to the model
CONSOLIDATION_PATCH_THRESHOLD = 8     # >= N patches  → full pass
CONSOLIDATION_TOKEN_THRESHOLD = 12000 # >= N tokens   → full pass


# ── System prompts ────────────────────────────────────────────────────────────

# /no_think suppresses thinking tokens on Qwen3 and similar models.
CONSOLIDATION_SYSTEM_PROMPT = """/no_think
You are a patch-consolidation assistant for an LLM development tool.
You receive a JSON list of shell-command patches that were automatically applied to a previous LLM response.
Your job: summarize them for the main LLM so it understands what changed.

Respond with a single JSON object — no markdown fences, no commentary. Exact schema:
{
  "changed_steps": [
    {
      "step_id": "<code block id, e.g. code-block-3>",
      "original": "<original command, one representative line>",
      "patched": "<patched command, one representative line>",
      "reason": "<one sentence: why this change was needed>"
    }
  ],
  "summary": "<2-3 sentences for the main LLM: what was patched and why, so it can reason correctly about task state>",
  "state_delta": "<key environment/OS facts inferred from these patches, e.g. 'User runs PowerShell on Windows 11'. Empty string if nothing new.>"
}
Output only valid JSON. Nothing else."""

LIGHTWEIGHT_SYSTEM_PROMPT = """/no_think
You are a patch-consolidation assistant for an LLM development tool.
You receive a small JSON list of shell-command patches applied to a previous LLM response.
Write a brief, plain-language summary so the main LLM knows what changed.

Respond with a single JSON object — no markdown fences, no commentary. Exact schema:
{
  "summary": "<1-2 sentences: what was patched and why>",
  "state_delta": "<key environment fact inferred from the patches, or empty string>"
}
Output only valid JSON. Nothing else."""


# ── Data models ───────────────────────────────────────────────────────────────

class PatchRecord(BaseModel):
    block_id: str
    lang: str
    original: str
    patched: str
    source: str  # "inline" | "error_popup"


class ChangedStep(BaseModel):
    step_id: str
    original: str
    patched: str
    reason: str


class ConsolidationResult(BaseModel):
    changed_steps: list[ChangedStep]
    summary: str
    state_delta: str
    patch_count: int
    mode: Literal["full", "lightweight"] = "full"


# ── Token estimation ──────────────────────────────────────────────────────────

def estimate_tokens(patches: list[PatchRecord]) -> int:
    """Rough character-based token estimate: (len(original) + len(patched)) // 4 per patch."""
    return sum((len(p.original) + len(p.patched)) // 4 for p in patches)


def should_run_consolidation(patches: list[PatchRecord]) -> tuple[bool, Literal["full", "lightweight"]]:
    """
    Decide whether to run a full Consolidation Pass or a lightweight summary.

    Returns:
        (True, "full")        — patch count or token estimate exceeds thresholds
        (False, "lightweight") — below both thresholds; still summarize, but lightly
    """
    count  = len(patches)
    tokens = estimate_tokens(patches)

    if count >= CONSOLIDATION_PATCH_THRESHOLD or tokens >= CONSOLIDATION_TOKEN_THRESHOLD:
        logger.info(
            "Consolidation: FULL pass triggered (patches=%d, ~tokens=%d, thresholds=%d/%d)",
            count, tokens, CONSOLIDATION_PATCH_THRESHOLD, CONSOLIDATION_TOKEN_THRESHOLD,
        )
        return True, "full"

    logger.info(
        "Consolidation: LIGHTWEIGHT summary (patches=%d, ~tokens=%d, thresholds=%d/%d)",
        count, tokens, CONSOLIDATION_PATCH_THRESHOLD, CONSOLIDATION_TOKEN_THRESHOLD,
    )
    return False, "lightweight"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _build_prompt(patches: list[PatchRecord]) -> str:
    payload = [
        {
            "block_id": p.block_id,
            "lang":     p.lang,
            "original": p.original,
            "patched":  p.patched,
            "source":   p.source,
        }
        for p in patches
    ]
    return (
        "Patches applied to the last assistant response:\n\n"
        + json.dumps(payload, indent=2)
        + "\n\nProduce the consolidation JSON now."
    )


def _extract_content(resp: dict) -> str:
    """Extract text from a chat_complete response; falls back to reasoning_content for thinking models."""
    msg     = resp.get("choices", [{}])[0].get("message", {})
    content = (msg.get("content") or "").strip()
    if content:
        return content
    reasoning = (msg.get("reasoning_content") or "").strip()
    if not reasoning:
        return ""
    # Try to extract last JSON block from reasoning
    blocks = re.findall(r"```[\w]*\n?([\s\S]*?)```", reasoning)
    if blocks:
        return blocks[-1].strip()
    lines = [ln.strip() for ln in reasoning.split("\n") if ln.strip()]
    return lines[-1] if lines else ""


def _strip_fences(raw: str) -> str:
    """Remove accidental markdown code fences from a raw JSON string."""
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    return raw


# ── Public API ────────────────────────────────────────────────────────────────

async def run_consolidation_pass(
    client,                    # BaseLLMClient
    patches: list[PatchRecord],
) -> Optional[ConsolidationResult]:
    """
    Ask Model B to summarize all applied patches.

    Automatically selects full vs lightweight mode based on smart thresholds.
    Returns None on any failure — caller continues normally (graceful degradation).
    """
    if not patches:
        return None

    capped = patches[:MAX_PATCHES_PER_PASS]
    if len(patches) > MAX_PATCHES_PER_PASS:
        logger.warning(
            "Consolidation: capped from %d to %d patches",
            len(patches), MAX_PATCHES_PER_PASS,
        )

    _, mode = should_run_consolidation(capped)

    if mode == "full":
        return await _run_full_pass(client, capped)
    return await _run_lightweight_summary(client, capped)


async def _run_full_pass(
    client,
    patches: list[PatchRecord],
) -> Optional[ConsolidationResult]:
    """Full Consolidation Pass: structured JSON with per-step breakdown."""
    logger.info("Consolidation: full pass for %d patch(es)", len(patches))
    try:
        resp = await client.chat_complete(
            messages=[
                {"role": "system", "content": CONSOLIDATION_SYSTEM_PROMPT},
                {"role": "user",   "content": _build_prompt(patches)},
            ],
            temperature=0.0,
            max_tokens=1024,
        )
        raw = _extract_content(resp)
        if not raw:
            logger.error("Consolidation (full): empty response from patcher")
            return None

        data   = json.loads(_strip_fences(raw))
        steps  = [ChangedStep(**s) for s in data.get("changed_steps", [])]
        result = ConsolidationResult(
            changed_steps=steps,
            summary=data.get("summary", ""),
            state_delta=data.get("state_delta", ""),
            patch_count=len(patches),
            mode="full",
        )
        logger.info("Consolidation (full): %d change(s) summarized", len(steps))
        return result

    except json.JSONDecodeError as exc:
        logger.error("Consolidation (full): invalid JSON — %s", exc)
        return None
    except Exception as exc:
        logger.error("Consolidation (full): unexpected error — %s", exc)
        return None


async def _run_lightweight_summary(
    client,
    patches: list[PatchRecord],
) -> Optional[ConsolidationResult]:
    """Lightweight summary: short prose, no per-step breakdown."""
    logger.info("Consolidation: lightweight summary for %d patch(es)", len(patches))
    try:
        resp = await client.chat_complete(
            messages=[
                {"role": "system", "content": LIGHTWEIGHT_SYSTEM_PROMPT},
                {"role": "user",   "content": _build_prompt(patches)},
            ],
            temperature=0.0,
            max_tokens=512,
        )
        raw = _extract_content(resp)
        if not raw:
            logger.error("Consolidation (lightweight): empty response from patcher")
            return None

        data   = json.loads(_strip_fences(raw))
        result = ConsolidationResult(
            changed_steps=[],
            summary=data.get("summary", ""),
            state_delta=data.get("state_delta", ""),
            patch_count=len(patches),
            mode="lightweight",
        )
        logger.info("Consolidation (lightweight): summary produced")
        return result

    except json.JSONDecodeError as exc:
        logger.error("Consolidation (lightweight): invalid JSON — %s", exc)
        return None
    except Exception as exc:
        logger.error("Consolidation (lightweight): unexpected error — %s", exc)
        return None


def format_for_main_model(result: ConsolidationResult) -> str:
    """
    Format a ConsolidationResult as a context block to append to the main model's
    system prompt on the next user turn.
    """
    mode_label = "Consolidation Pass" if result.mode == "full" else "Lightweight Patch Summary"
    lines = [
        f"[{mode_label} — {result.patch_count} patch(es) applied to the previous response]",
        "",
        result.summary,
    ]
    if result.state_delta:
        lines += ["", f"Environment notes: {result.state_delta}"]
    if result.changed_steps:
        lines += ["", "Changed blocks:"]
        for s in result.changed_steps:
            orig  = (s.original[:80] + "…") if len(s.original)  > 80 else s.original
            patch = (s.patched[:80]  + "…") if len(s.patched)   > 80 else s.patched
            lines.append(f"  • {s.step_id}: `{orig}` → `{patch}` — {s.reason}")
    return "\n".join(lines)
