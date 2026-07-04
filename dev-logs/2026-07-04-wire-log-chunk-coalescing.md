# Dev Log — 2026-07-04 — Coalesce streaming chunks in the ACP wire log

## Version: 0.9.5 (patch)

---

### Context

With Debug Mode on, the plugin taps the agent's stdin/stdout and appends
every JSON-RPC frame to `acp-wire.log` (2 MB cap, oldest-half rotation).
Streamed responses arrive one token per `session/update` frame — a single
thinking-heavy turn (e.g. `/fix-idea`) produced thousands of
`agent_thought_chunk` / `agent_message_chunk` lines, rotated the useful
frames (tool calls, permission requests, errors) out of the log within a
turn or two, and made the log unreadable for diagnosis.

---

### Chunk coalescing

**Status**: ✅ Done (verified on a live `/fix-idea` run)

**File changed:** `src/shared/error-log.ts`

- `logWireLine()` now routes through a new
  `ErrorLog.logWireFrameCoalesced()`. Text-content chunk frames
  (`agent_message_chunk`, `agent_thought_chunk`, `user_message_chunk`) are
  buffered per (direction, sessionId, messageId, kind) and written as
  **one summary line**:

  ```json
  {"direction":"in","frame":{"coalesced":true,"sessionUpdate":"agent_thought_chunk",
   "messageId":"…","chunks":8,"firstTimestamp":"…","lastTimestamp":"…",
   "text":"<assembled text>"}}
  ```

  Assembled text goes through the existing `safeStringify` truncation
  (4,000 chars per field), so a long response can't blow the log either.
- **Everything else stays verbatim** — tool_call / tool_call_update,
  permission requests/responses, plans, usage_update, errors. Any buffered
  run is flushed *before* a non-chunk frame is written, so the log stays in
  true wire order.
- A key change (new messageId, thought→message switch, direction change)
  flushes the previous run; a 2 s idle timer flushes the tail of a stream
  so the end of a response isn't held in memory.
- Non-text chunks (image/audio) are rare and stay verbatim; empty-text
  chunks don't start a run (they'd flush as a useless
  `{chunks: 1, text: ""}` line).

### Result

A live `/fix-idea` run that previously filled the 2 MB log with rotation
headers now fits comfortably: each thought/response stream is one line with
a `chunks` count, and every tool call, Edit diff, permission prompt, and
error frame around it is intact and in order.

### Known cosmetic quirk (accepted)

`firstTimestamp` reflects chunk *arrival*; write order is flush order. A
chunk arriving while a non-chunk frame's flush is mid-write can produce a
record whose timestamp is a few ms earlier than the line above it. Ordering
of the lines themselves remains correct.
