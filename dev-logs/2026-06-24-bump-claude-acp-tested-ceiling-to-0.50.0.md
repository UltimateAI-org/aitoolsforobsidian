# Dev Log — 2026-06-24 — Bump Claude ACP tested ceiling to 0.50.0

## Version: 0.9.3 (patch)

---

### Context

`@agentclientprotocol/claude-agent-acp` has shipped through to **0.50.0**
on npm since 0.9.2 set the tested ceiling at 0.44.0. Users on 0.45.x –
0.50.x installs were seeing the compat warning + matching settings-row
rollback affordance for versions that have been compatible the whole way.

Pure constant bump — no other code changed.

---

### `AGENT_MAX_TESTED_VERSIONS["claude-code-acp"]` 0.44.0 → 0.50.0

**Status**: ✅ Done

**File changed:** `src/shared/version-checker.ts`

Same one-line change as the 0.9.2 release; same automatic downstream
effects via the 0.9.1 infrastructure:

- Chat-side `CompatWarningBanner` stops appearing for 0.45.x – 0.50.x
  installs (`isAboveTestedVersion` becomes false).
- Settings → Claude Agent row drops the "Newer than tested" suffix and
  hides the rollback button.
- If claude-agent-acp ships 0.51.x next, the banner returns with
  "Roll back to v0.50.0" — no further changes needed.

Gemini's ceiling stays at 0.43.0.
