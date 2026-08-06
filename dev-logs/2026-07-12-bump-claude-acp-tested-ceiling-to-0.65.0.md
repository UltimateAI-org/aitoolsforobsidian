# Dev Log — 2026-07-12 — Bump claude-agent-acp tested ceiling to 0.65.0

## Version: 0.9.6 (patch)

---

### Context

`@agentclientprotocol/claude-agent-acp` shipped 0.56.x → 0.65.0 since the
0.9.4 ceiling bump to 0.55.0. Paul verified 0.65.0 against this plugin —
including the v0.9.6 features landed the same day (message queueing,
quick prompts, parallel session tabs with a process per tab).

---

### Ceiling bump

**Status**: ✅ Done

**File changed:** `src/shared/version-checker.ts`

`AGENT_MAX_TESTED_VERSIONS["claude-code-acp"]`: `0.55.0` → `0.65.0`.
Gemini's ceiling stays at 0.43.0.

Downstream effects flow automatically:

- `CompatWarningBanner` stops appearing for 0.56.x – 0.65.0 installs.
- Settings → Claude Agent row drops the "Newer than tested" suffix and
  hides the rollback button.
- The agent-update banner for 0.65.0 uses the normal "Update" prompt
  rather than the cautious "not yet tested / Update anyway" wording,
  since latest ≤ ceiling again.
- If 0.66.x ships next, the untested wording and rollback affordance
  return automatically — no further changes needed.
