"""
Per-account login lockout (complements the per-IP throttle).

The IP throttle stops single-source brute force; it does nothing against a
distributed guess spread over many addresses, and a whole school behind one
NAT can't afford a tighter IP cap. So failures are ALSO counted per
(role, username) in the cache: after LOCKOUT_THRESHOLD failures inside
WINDOW_SECONDS the pair locks for LOCKOUT_SECONDS.

Keys are the attempted identifier, not the account — the counter behaves
identically whether or not the username exists, so lockout responses leak
nothing about which accounts are real. Counters live in the cache (Redis in
production): surviving a process restart matters less than never touching
the accounts table from an unauthenticated path.
"""

import time

from django.core.cache import cache

LOCKOUT_THRESHOLD = 8
WINDOW_SECONDS = 15 * 60
LOCKOUT_SECONDS = 15 * 60


def _key(role: str, username: str) -> str:
    return f"login-fail:{role}:{username.strip().lower()}"


def seconds_remaining(role: str, username: str) -> int:
    """0 when the pair may attempt a login; otherwise seconds until unlock."""
    state = cache.get(_key(role, username))
    if not state or state.get("count", 0) < LOCKOUT_THRESHOLD:
        return 0
    remaining = int(state.get("locked_until", 0) - time.time())
    return max(remaining, 0)


def register_failure(role: str, username: str) -> bool:
    """Count one failed attempt. Returns True when THIS failure locked the
    account (the caller writes the audit event exactly once)."""
    key = _key(role, username)
    state = cache.get(key) or {"count": 0}
    state["count"] += 1
    if state["count"] >= LOCKOUT_THRESHOLD:
        state["locked_until"] = time.time() + LOCKOUT_SECONDS
        cache.set(key, state, LOCKOUT_SECONDS)
        return state["count"] == LOCKOUT_THRESHOLD
    cache.set(key, state, WINDOW_SECONDS)
    return False


def reset(role: str, username: str) -> None:
    cache.delete(_key(role, username))
