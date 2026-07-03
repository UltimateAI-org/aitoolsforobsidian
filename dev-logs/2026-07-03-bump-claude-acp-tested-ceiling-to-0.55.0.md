# Dev Log — 2026-07-03 — Bump claude-agent-acp tested ceiling to 0.55.0

## Version: 0.9.4 (patch)

---

### Context

`@agentclientprotocol/claude-agent-acp` shipped 0.51.0 → 0.55.0 since the
0.9.3 ceiling bump to 0.50.0. 0.54.1 was misbehaving (we deliberately stayed
on 0.50.0 and used the rollback flow ourselves), but 0.55.0 (published
2026-07-02) has been verified stable against this plugin.

---

### Ceiling bump

**Status**: ✅ Done

**File changed:** `src/shared/version-checker.ts`

`AGENT_MAX_TESTED_VERSIONS["claude-code-acp"]`: `0.50.0` → `0.55.0`.
Gemini's ceiling stays at 0.43.0.

Downstream effects flow automatically:

- `CompatWarningBanner` stops appearing for 0.51.x – 0.55.0 installs.
- Settings → Claude Agent row drops the "Newer than tested" suffix and
  hides the rollback button.
- The agent-update banner for 0.55.0 switches from the new cautious
  "not yet tested / Update anyway" wording (added earlier today) back to
  the normal "Update" prompt, since latest ≤ ceiling again.
- If 0.56.x ships next, the untested wording and rollback affordance
  return automatically — no further changes needed.
