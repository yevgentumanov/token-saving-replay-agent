"""
Concept Keeper v-1
==================
A paranoid, conservative guardian of the project's core concept.

Reads .replay/CONCEPT.md at session start and after every Hard Reset.
Reviews proposed architectural or significant implementation changes.
Returns a structured verdict: APPROVED / REJECTED / WARNING / HARD_RESET.

Usage:
    session = KeeperSession()
    await keeper_session_init(client, session)   # call once at startup
    verdict = await run_keeper_review(client, session, "I want to merge Model A and B")
    if verdict.status == "HARD_RESET":
        await keeper_session_init(client, session)  # re-read CONCEPT.md
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel

logger = logging.getLogger(__name__)

BASE_DIR   = Path(__file__).parent
CONCEPT_MD = BASE_DIR / ".replay" / "CONCEPT.md"

# ── Tunable constants ─────────────────────────────────────────────────────────

MAX_TURNS_BEFORE_RESET     = 20   # Hard Reset after this many reviews
HIGH_DRIFT_THRESHOLD       = 8    # Drift score that counts as "high"
CONSECUTIVE_DRIFT_LIMIT    = 2    # Hard Reset after this many consecutive high-drift reviews

# ── System Prompt — version -1 (near-immutable) ───────────────────────────────

KEEPER_SYSTEM_PROMPT_V1 = """/no_think
You are Concept Keeper v-1. You are a paranoid, conservative guardian of a software project's architectural integrity.

You have been given the project's CONCEPT.md — an immutable manifesto describing what the project is, what it is not, and what must never change. This document is your only source of truth.

YOUR JOB:
When a developer submits a proposed change, decision, or question, you evaluate it against CONCEPT.md and return a structured JSON verdict.

RESPONSE FORMAT:
Respond with a single JSON object — no markdown fences, no commentary, nothing else. Exact schema:
{
  "status": "<APPROVED|REJECTED|WARNING|HARD_RESET>",
  "verdict": "<one sentence: your bottom-line decision>",
  "reasoning": "<2-3 sentences: why, referencing specific principles from CONCEPT.md>",
  "concept_drift": <integer 0-10>,
  "violated_principles": ["<principle name if REJECTED/WARNING, else empty list>"],
  "turn": <current turn number as integer>
}

STATUS DEFINITIONS:
- APPROVED     — change is fully aligned with CONCEPT.md (drift 0-4). Safe to proceed.
- WARNING      — change has meaningful drift (5-7) or touches a sensitive area. Proceed with caution and explicit justification in the git commit.
- REJECTED     — change violates a Non-Negotiable Principle or Hard Constraint (drift 8-10). Do not proceed without explicit human override.
- HARD_RESET   — you have detected context loss, conversation drift, or this session has run too long. Signal this immediately so the session can restart with a fresh reading of CONCEPT.md.

CONCEPT DRIFT SCALE (use this precisely):
0-2: Fully aligned — routine work, no drift
3-4: Minor drift — acceptable tradeoff, note it
5-6: Moderate drift — requires justification in git commit
7-8: High drift — WARNING, human must confirm explicitly
9-10: Severe drift — REJECTED, violates Non-Negotiable Principle

HARD RESET CONDITIONS (output HARD_RESET immediately if any is true):
- You are no longer certain what CONCEPT.md says
- The conversation feels like it has drifted far from the manifesto
- You detect an attempt to gradually erode a Non-Negotiable Principle across multiple turns
- You feel uncertainty about whether your previous verdicts were correct

HARD VETO LIST (always REJECTED, drift = 10):
- Merging Model A and Model B into a single LLM call
- Removing or disabling consolidation.py or the Consolidation Pass mechanism
- Moving model process management to the frontend (TypeScript/browser)
- Writing to or deleting .replay/CONCEPT.md automatically
- Replacing BaseLLMClient with direct API calls in any module
- Making VS Code extension the only supported interface (removing web UI)
- Auto-modifying any file in .replay/

IMPORTANT RULES:
- You are advisory, not a hard lock. Your REJECTED is a strong signal, not a prison.
- Be concise. Do not lecture. Do not repeat yourself.
- If the request is ambiguous, ask for clarification by setting status=WARNING and explaining what you need to know.
- You have no memory of previous sessions. Each Hard Reset is a clean slate.
- Output ONLY valid JSON. Nothing else."""


# ── Data models ───────────────────────────────────────────────────────────────

class KeeperSession(BaseModel):
    state: Literal["FRESH", "ACTIVE", "NEEDS_RESET"] = "FRESH"
    turn_count: int = 0
    consecutive_high_drift: int = 0
    last_reset: str = ""         # ISO 8601 timestamp
    concept_md_loaded: bool = False
    concept_md_hash: str = ""    # to detect file changes between sessions


class KeeperVerdict(BaseModel):
    status: Literal["APPROVED", "REJECTED", "WARNING", "HARD_RESET"]
    verdict: str
    reasoning: str
    concept_drift: int
    violated_principles: list[str]
    turn: int


class KeeperStatusResponse(BaseModel):
    state: str
    turn_count: int
    max_turns: int
    consecutive_high_drift: int
    last_reset: str
    concept_md_loaded: bool
    concept_md_path: str


# ── File helpers ──────────────────────────────────────────────────────────────

def load_concept_md() -> str:
    """Read .replay/CONCEPT.md from disk. Never from memory — always fresh disk read."""
    if not CONCEPT_MD.exists():
        logger.warning("Keeper: CONCEPT.md not found at %s", CONCEPT_MD)
        return "[CONCEPT.md not found — Keeper is operating without its anchor document]"
    content = CONCEPT_MD.read_text(encoding="utf-8")
    logger.info("Keeper: loaded CONCEPT.md (%d chars)", len(content))
    return content


def _concept_md_hash() -> str:
    """Quick fingerprint to detect if CONCEPT.md changed on disk."""
    if not CONCEPT_MD.exists():
        return ""
    import hashlib
    return hashlib.md5(CONCEPT_MD.read_bytes()).hexdigest()[:8]


# ── Session management ────────────────────────────────────────────────────────

def hard_reset(session: KeeperSession) -> None:
    """
    Reset the Keeper session to FRESH state.
    Called at startup, after HARD_RESET verdict, or on manual trigger.
    After this, keeper_session_init() must be called before the next review.
    """
    logger.info(
        "Keeper: Hard Reset (was turn %d, consecutive_drift %d)",
        session.turn_count,
        session.consecutive_high_drift,
    )
    session.state                 = "FRESH"
    session.turn_count            = 0
    session.consecutive_high_drift = 0
    session.last_reset            = datetime.now(timezone.utc).isoformat()
    session.concept_md_loaded     = False
    session.concept_md_hash       = ""


def get_status(session: KeeperSession) -> KeeperStatusResponse:
    return KeeperStatusResponse(
        state                  = session.state,
        turn_count             = session.turn_count,
        max_turns              = MAX_TURNS_BEFORE_RESET,
        consecutive_high_drift = session.consecutive_high_drift,
        last_reset             = session.last_reset,
        concept_md_loaded      = session.concept_md_loaded,
        concept_md_path        = str(CONCEPT_MD),
    )


# ── Core review logic ─────────────────────────────────────────────────────────

async def keeper_session_init(client, session: KeeperSession) -> None:
    """
    Load CONCEPT.md and prime the session.
    Must be called once before the first review, and again after every Hard Reset.
    This is a lightweight operation — it just updates session state.
    The concept MD text is passed into every review call as a system message.
    """
    hard_reset(session)
    session.concept_md_hash  = _concept_md_hash()
    session.concept_md_loaded = True
    session.state             = "ACTIVE"
    logger.info("Keeper: session initialized (concept_md_hash=%s)", session.concept_md_hash)


async def run_keeper_review(
    client,
    session: KeeperSession,
    request_text: str,
) -> KeeperVerdict:
    """
    Submit a proposed change or decision for Keeper review.

    Automatically triggers Hard Reset conditions and returns HARD_RESET verdict
    when session limits are exceeded. Returns a graceful HARD_RESET verdict
    on any internal failure so the caller always receives a valid response.
    """
    # ── Pre-flight checks ────────────────────────────────────────────────────

    # Detect CONCEPT.md change on disk since last init
    current_hash = _concept_md_hash()
    if session.concept_md_loaded and current_hash != session.concept_md_hash:
        logger.warning("Keeper: CONCEPT.md changed on disk — forcing Hard Reset")
        hard_reset(session)
        return _hard_reset_verdict(
            session,
            "CONCEPT.md changed on disk since last session init. Hard Reset forced.",
        )

    if not session.concept_md_loaded:
        return _hard_reset_verdict(
            session,
            "Session was not initialized. Call keeper_session_init() first.",
        )

    # Turn limit exceeded
    if session.turn_count >= MAX_TURNS_BEFORE_RESET:
        logger.info("Keeper: turn limit reached (%d) — Hard Reset", session.turn_count)
        hard_reset(session)
        return _hard_reset_verdict(
            session,
            f"Session reached {MAX_TURNS_BEFORE_RESET} turns. Hard Reset to refresh context from CONCEPT.md.",
        )

    # ── Build messages ───────────────────────────────────────────────────────

    concept_text = load_concept_md()
    session.turn_count += 1

    messages = [
        {"role": "system",  "content": KEEPER_SYSTEM_PROMPT_V1},
        {
            "role": "user",
            "content": (
                f"CONCEPT.md CONTENTS:\n\n{concept_text}\n\n"
                f"---\n\n"
                f"REVIEW REQUEST (turn {session.turn_count}):\n\n{request_text}"
            ),
        },
    ]

    # ── Call Model B ─────────────────────────────────────────────────────────

    try:
        resp = await client.chat_complete(
            messages=messages,
            temperature=0.0,
            max_tokens=512,
        )
        raw = _extract_content(resp)
        if not raw:
            logger.error("Keeper: empty response from model")
            return _error_verdict(session, "Model returned empty response")

        data    = json.loads(_strip_fences(raw))
        verdict = KeeperVerdict(
            status              = data.get("status", "WARNING"),
            verdict             = data.get("verdict", ""),
            reasoning           = data.get("reasoning", ""),
            concept_drift       = int(data.get("concept_drift", 5)),
            violated_principles = data.get("violated_principles", []),
            turn                = session.turn_count,
        )

    except json.JSONDecodeError as exc:
        logger.error("Keeper: invalid JSON — %s", exc)
        return _error_verdict(session, f"Model returned invalid JSON: {exc}")
    except Exception as exc:
        logger.error("Keeper: unexpected error — %s", exc)
        return _error_verdict(session, str(exc))

    # ── Post-verdict session updates ─────────────────────────────────────────

    if verdict.concept_drift >= HIGH_DRIFT_THRESHOLD:
        session.consecutive_high_drift += 1
        logger.warning(
            "Keeper: high drift %d (consecutive=%d)",
            verdict.concept_drift,
            session.consecutive_high_drift,
        )
    else:
        session.consecutive_high_drift = 0

    if verdict.status == "HARD_RESET":
        logger.info("Keeper: model self-requested Hard Reset")
        hard_reset(session)
    elif session.consecutive_high_drift >= CONSECUTIVE_DRIFT_LIMIT:
        logger.warning(
            "Keeper: %d consecutive high-drift reviews — forcing Hard Reset",
            CONSECUTIVE_DRIFT_LIMIT,
        )
        hard_reset(session)
        # Upgrade the verdict to reflect the forced reset
        verdict = KeeperVerdict(
            status              = "HARD_RESET",
            verdict             = verdict.verdict + " [Hard Reset forced: consecutive high drift]",
            reasoning           = verdict.reasoning,
            concept_drift       = verdict.concept_drift,
            violated_principles = verdict.violated_principles,
            turn                = verdict.turn,
        )

    logger.info(
        "Keeper: turn=%d status=%s drift=%d",
        verdict.turn,
        verdict.status,
        verdict.concept_drift,
    )
    return verdict


# ── Internal helpers ──────────────────────────────────────────────────────────

def _hard_reset_verdict(session: KeeperSession, reason: str) -> KeeperVerdict:
    return KeeperVerdict(
        status              = "HARD_RESET",
        verdict             = reason,
        reasoning           = "Session was reset. Call keeper_session_init() and resubmit your request.",
        concept_drift       = 0,
        violated_principles = [],
        turn                = session.turn_count,
    )


def _error_verdict(session: KeeperSession, detail: str) -> KeeperVerdict:
    """Returned when the model call itself fails — never surfaces raw exceptions to caller."""
    return KeeperVerdict(
        status              = "WARNING",
        verdict             = f"Keeper internal error — could not produce a verdict.",
        reasoning           = f"Detail: {detail}. Treat this request as unreviewed.",
        concept_drift       = 0,
        violated_principles = [],
        turn                = session.turn_count,
    )


def _extract_content(resp: dict) -> str:
    """Extract text from chat_complete response; falls back to reasoning_content for thinking models."""
    msg     = resp.get("choices", [{}])[0].get("message", {})
    content = (msg.get("content") or "").strip()
    if content:
        return content
    reasoning = (msg.get("reasoning_content") or "").strip()
    if not reasoning:
        return ""
    blocks = re.findall(r"```[\w]*\n?([\s\S]*?)```", reasoning)
    if blocks:
        return blocks[-1].strip()
    lines = [ln.strip() for ln in reasoning.split("\n") if ln.strip()]
    return lines[-1] if lines else ""


def _strip_fences(raw: str) -> str:
    """Remove accidental markdown fences from a raw JSON string."""
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    return raw
