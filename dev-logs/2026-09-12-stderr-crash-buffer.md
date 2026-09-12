# Dev Log — 2026-09-12 — Buffer agent stderr, persist only on failure

## Version: 1.0.0

---

## 🐛 Problem

`acp.adapter.ts` wrote **every** agent stderr chunk to two places
unconditionally: `console.error` and `error.log`.

Agents use stderr for routine telemetry, not errors. A typical entry:

```
[session/create] sessionId=... phase=settings durationMs=36 totalMs=37
[session/query]  sessionId=... resume=none apiType=native baseUrl=native
[authStatus] session account carries no identity signal; keeping probe
```

Three weeks of Paul's log contained **zero actual errors** — all telemetry.

Neither sink was debug-gated (the only `debugMode` checks in
`error-log.ts` are in `logWireFrame`/`logWireFrameCoalesced`), so this
affected every user, not just those with debug mode on. Debug mode and
DevTools being open are different switches: the console output was always
written, it just went unseen unless DevTools was opened.

The consequential part was **not** the noise. `error.log` is capped at
512 KB and drops the oldest ~50% on overflow, so routine telemetry
steadily **evicted real failures** from the file that exists to preserve
them. Parallel session tabs made this up to 4× faster — one process per
tab, each emitting its own stderr.

Also relevant: `error.log` was ~99% stderr, since the only other source
actually writing to it is `acp-prompt-error`.

---

## ✅ Change

**Status**: ✅ Done (awaiting local testing)

Stderr is now held in memory and written to disk **only when it becomes
evidence**.

- **Console**: routed through `Logger` (debug-gated) instead of raw
  `console.error`, so users no longer see red entries on every load
- **Memory**: rolling buffer of the last `MAX_BUFFERED_STDERR_CHUNKS`
  (200) chunks, trimmed as it grows; nothing on disk
- **On abnormal exit**: the existing `close` handler flushes the buffer
  to `error.log` when the exit was not requested by us, titled with the
  exit code and signal — so a crash yields the tight run-up to the failure
- **On a prompt error**: the buffer is also flushed, covering the case the
  close handler cannot — an agent that misbehaves but keeps running
- **Healthy runs write nothing**

The persistence trigger is **process exit status — a fact, not a content
heuristic**. No regex decides whether a line "looks like" an error, so no
unusual line can be silently discarded. This was the explicit design
constraint: capture-time filtering is irreversible and its failure mode
(losing the one line that mattered) is invisible until you need the log.

### Rejected alternatives

- **Blanket suppression** — would have removed crash diagnostics, which
  the original code comment deliberately wanted without debug mode.
- **Content classification** (`/error|exception|fatal/i` at capture time) —
  irreversible misclassification risk.
- **Separate `agent-stderr.log`** — considered and rejected: since
  `error.log` is ~99% stderr, this would leave the file users are asked to
  send nearly **empty**, with the content in a secondary file nobody knows
  about. Worse support story.
- **Patching `console.error` globally** — would swallow other plugins'
  errors in a shared console.

### Files

- `src/adapters/acp/acp.adapter.ts`
  - `MAX_BUFFERED_STDERR_CHUNKS` constant
  - `stderrBuffer` + `intentionalShutdown` fields
  - `flushStderrBuffer(reason, agentId)` helper
  - stderr handler: buffer + debug-gated log, no disk write
  - `close` handler: flush on unexpected exit, clear otherwise
  - `disconnect()`: sets `intentionalShutdown` so our own kill is not a crash
  - spawn site: resets buffer and flag per process
  - prompt-error path: flushes buffer as context

## 🧪 Testing

1. **Normal use** — reload, start a session, send messages. DevTools
   console shows no red `[AcpAdapter] … stderr:` entries with debug mode
   off; Settings → Diagnostics → error log gains no new entries.
2. **Debug mode on** — stderr reappears in the console as `console.debug`.
3. **Crash path** — point an agent at an invalid command so the process
   exits non-zero; error log should gain one entry titled
   "… process exited unexpectedly (code: …)" containing the buffered
   output.
4. **Clean shutdown** — close the chat panel / switch agents; no crash
   entry is written (intentional shutdown).
