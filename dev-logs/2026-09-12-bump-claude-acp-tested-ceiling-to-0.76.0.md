# Dev Log — 2026-09-12 — Bump claude-agent-acp tested ceiling to 0.76.0

## Version: 1.0.0 (patch)

---

### Context

`@agentclientprotocol/claude-agent-acp` shipped 0.71.0 → 0.76.0 since the
ceiling bump to 0.70.0 on 2026-08-20. 0.76.0 is the current npm `latest`
(0.76.1-preview.2 is on the `preview` tag and is deliberately not covered
by the ceiling, which tracks stable releases only).

Paul verified 0.76.0 against the plugin. Supporting evidence from his
error log: entries from 2026-09-09 onward carry the newer agent's
`[session/create] phase=... durationMs=...` telemetry, which the pre-0.7x
builds did not emit — so a newer agent has been in daily use for several
days without incident.

---

### Ceiling bump

**Status**: ✅ Done

**File changed:** `src/shared/version-checker.ts`

`AGENT_MAX_TESTED_VERSIONS["claude-code-acp"]`: `0.70.0` → `0.76.0`.
Gemini's ceiling stays at 0.43.0.

This covers the whole 0.71.0 – 0.76.0 range, not just the endpoint — the
constant is an upper bound, so every intermediate version stops warning
too.

Downstream effects flow automatically:

- `CompatWarningBanner` stops appearing for 0.71.x – 0.76.0 installs.
- Settings → Claude Agent row drops the "Newer than tested" suffix and
  hides the rollback button.
- The agent-update banner for 0.76.0 uses the normal "Update" prompt
  rather than the cautious "not yet tested / Update anyway" wording,
  since latest ≤ ceiling again.
- If 0.77.x ships next, the untested wording and rollback affordance
  return automatically — no further changes needed.

---

### Observation (not fixed here): error log is full of non-errors

Reviewing ~3 weeks of Paul's error log (2026-08-24 → 2026-09-11) found
**zero actual errors**. Every entry is routine agent telemetry written to
stderr:

- `[session/query] sessionId=... resume=none apiType=native baseUrl=native`
- `[session/create] sessionId=... phase=settings durationMs=36 totalMs=37`
- `[authStatus] session account carries no identity signal; keeping probe`

Cause: `acp.adapter.ts` (~line 463) pipes **every** stderr chunk into
`errorLog.logError()` unconditionally. claude-agent-acp uses stderr for
informational logging, as many CLIs do, so the error log is mostly noise
and a real error would be hard to spot in it.

Worth addressing separately — either classify stderr by severity before
logging, or keep a rolling diagnostic buffer distinct from the error log.
Not done here to keep this change to the ceiling bump.
