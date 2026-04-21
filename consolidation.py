"""
Phase 2.5 — Consolidation Pass

After Model B (patcher) applies inline fixes during a single main-model turn,
this module asks Model B to produce a structured JSON summary of all changes.
That summary is injected into the next main-model request so Model A works with
accurate context instead of a stale one.

Limit: MAX_PATCHES_PER_PASS — prevents overly long consolidation prompts.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Optional

from pydantic import BaseModel

logger = logging.getLogger(__name__)

MAX_PATCHES_PER_PASS = 10

# /no_think suppresses thinking tokens on Qwen3 and similar models.
# Consolidation output must be pure JSON — the prompt enforces this strictly.
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


# ── Helpers ───────────────────────────────────────────────────────────────────

def _build_prompt(patches: list[PatchRecord]) -> str:
    payload = [
        {
            "block_id": p.block_id,
            "lang": p.lang,
            "original": p.original,
            "patched": p.patched,
            "source": p.source,
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
    msg = resp.get("choices", [{}])[0].get("message", {})
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


# ── Public API ────────────────────────────────────────────────────────────────

async def run_consolidation_pass(
    client,  # BaseLLMClient
    patches: list[PatchRecord],
) -> Optional[ConsolidationResult]:
    """
    Ask Model B to summarize all applied patches into a ConsolidationResult.
    Returns None on any failure — caller continues normally (graceful degradation).
    """
    if not patches:
        return None

    capped = patches[:MAX_PATCHES_PER_PASS]
    if len(patches) > MAX_PATCHES_PER_PASS:
        logger.warning(
            "Consolidation Pass: capped from %d to %d patches",
            len(patches), MAX_PATCHES_PER_PASS,
        )

    logger.info("Consolidation Pass: requesting summary for %d patch(es)", len(capped))

    try:
        resp = await client.chat_complete(
            messages=[
                {"role": "system", "content": CONSOLIDATION_SYSTEM_PROMPT},
                {"role": "user",   "content": _build_prompt(capped)},
            ],
            temperature=0.0,
            max_tokens=1024,
        )
        raw = _extract_content(resp)
        if not raw:
            logger.error("Consolidation Pass: empty response from patcher")
            return None

        # Strip accidental markdown fences
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

        data = json.loads(raw)
        steps = [ChangedStep(**s) for s in data.get("changed_steps", [])]
        result = ConsolidationResult(
            changed_steps=steps,
            summary=data.get("summary", ""),
            state_delta=data.get("state_delta", ""),
            patch_count=len(capped),
        )
        logger.info("Consolidation Pass: %d change(s) summarized", len(steps))
        return result

    except json.JSONDecodeError as exc:
        logger.error("Consolidation Pass: invalid JSON from patcher — %s", exc)
        return None
    except Exception as exc:
        logger.error("Consolidation Pass: unexpected error — %s", exc)
        return None


def format_for_main_model(result: ConsolidationResult) -> str:
    """
    Format a ConsolidationResult as a context block to append to the main model's
    system prompt on the next user turn.
    """
    lines = [
        f"[Consolidation Pass — {result.patch_count} patch(es) applied to the previous response]",
        "",
        result.summary,
    ]
    if result.state_delta:
        lines += ["", f"Environment notes: {result.state_delta}"]
    if result.changed_steps:
        lines += ["", "Changed blocks:"]
        for s in result.changed_steps:
            orig  = (s.original[:80]  + "…") if len(s.original)  > 80 else s.original
            patch = (s.patched[:80]   + "…") if len(s.patched)   > 80 else s.patched
            lines.append(f"  • {s.step_id}: `{orig}` → `{patch}` — {s.reason}")
    return "\n".join(lines)
