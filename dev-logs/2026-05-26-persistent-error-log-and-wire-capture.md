# Dev Log — 2026-05-26 — Persistent error log & ACP wire capture

## Version: 0.9.0 (patch)

---

### Context

A user hit "Authentication Required" in the chat UI while sending a prompt to
Claude Agent. The actual underlying failure was a JSON-RPC `code: -32603` with
`message: "Internal error: API Error: The socket connection was closed
unexpectedly"` and `errorKind: "unknown"` — a network/socket failure, not an
auth problem.

The plugin mislabelled it because `handleSendError()` falls through to the
auth branch for any error that isn't a rate limit or empty-response. Worse,
the only diagnostic trail was the DevTools console — gone the moment the
plugin reloads, and useless to anyone reporting the issue without DevTools
already open.

This change adds a persistent, on-disk diagnostic trail so future failures
of this kind are recoverable without DevTools, and so the server owner can
correlate exact wire traffic when an issue is reported.

---

### 1. Persistent NDJSON error log

**Status**: ✅ Added

**New file:** `src/shared/error-log.ts`

`ErrorLog` class with `logError()`, `readErrorEntries()`, `clearErrorLog()`.
Writes to `<vault>/<configDir>/plugins/obsidianaitools/error.log` as
NDJSON (one JSON object per line) so it's easy to share via copy/paste or
inspect by hand. Each entry captures:

- `timestamp` (ISO 8601)
- `source` — `acp-stderr` | `acp-prompt-error` | `send-error` | `auth` | …
- `agentId`, `sessionId`
- `message`, `code`, `errorKind`, `data`, `stack`

**Rotation:** when the file grows past 512 KB the oldest ~half is dropped on
the next write, on a line boundary so NDJSON stays valid. A marker entry is
inserted to signal the rotation happened. No external log-rotation library;
~10 lines of code, bounded growth.

**Crash-safe:** all writes go through `appendLine()` which serializes through
a chained Promise — never throws into the caller, swallows adapter failures
internally and logs a single `console.warn`. Logging must never break the
calling path.

**`describeError(unknown)` helper:** centralises the
"is-this-an-Error / JSON-RPC-error-object / string / primitive" decoding
that otherwise gets sprinkled at every catch site. Returns
`{ message, code?, errorKind?, data?, stack? }`.

---

### 2. ACP wire-frame capture (debug-mode only)

**Status**: ✅ Added

**Files changed:** `src/adapters/acp/acp.adapter.ts`, `src/shared/error-log.ts`

When debug mode is on, every JSON-RPC frame in *both* directions is captured
to `<vault>/<configDir>/plugins/obsidianaitools/acp-wire.log`. Implemented by
inserting `TransformStream` taps between the spawned agent's stdio and the
ACP library's `ndJsonStream()`:

```
spawned process stdout → rawOutput (ReadableStream)
                       → tapReadable() ← logs each line
                       → ndJsonStream → ACP

ACP → ndJsonStream
    → rawInput (WritableStream)
    → tapWritable() ← logs each line
    → spawned process stdin
```

The taps are byte-in / byte-out: they decode UTF-8, split on `\n`, log each
complete line via `logWireLine()`, and re-enqueue the original chunk
unchanged. ACP sees the exact same stream — there is no behaviour change.

**Why debug-mode-gated:** frame volume is high (streaming chunks for every
reply), and most users will never need this. The error log alone catches
the failure; the wire log is the next step when the error log doesn't tell
the full story.

**Rotation:** 2 MB cap on `acp-wire.log`, same line-boundary rotation as
`error.log`.

---

### 3. AcpAdapter logging hooks

**Status**: ✅ Wired

**File changed:** `src/adapters/acp/acp.adapter.ts`

Two existing log sites now also write to `error.log`:

| Site | Source tag | What gets logged |
|---|---|---|
| `agentProcess.stderr.on("data")` | `acp-stderr` | Raw stderr text |
| `prompt()` catch block | `acp-prompt-error` | Full JSON-RPC error via `describeError()` |

**Coverage rationale:** every error that reaches the chat UI passes through
the adapter's `prompt()` catch first, *before* `message-service.ts` re-buckets
it. Logging there captures the raw API error even when the plugin later
mislabels it (as in the original incident). No need to also hook
`handleSendError()` in message-service — that would just duplicate the
plugin's own (sometimes-wrong) categorization.

---

### 4. Diagnostics UI in settings

**Status**: ✅ Added

**New file:** `src/components/settings/ErrorLogModal.ts`

**File changed:** `src/components/settings/AgentClientSettingTab.ts`

Settings → **Diagnostics** section with three buttons:

- **View** — opens `ErrorLogModal`: scrollable list of the last 50 entries
  (newest first), each rendered with timestamp, source tag, agent badge,
  message, structured meta (code/errorKind/sessionId), and collapsible
  `data` / `stack` blocks.
- **Copy** — copies the full NDJSON to clipboard for sharing in bug reports.
- **Clear** — deletes `error.log`.

When debug mode is on, a second row appears for `acp-wire.log` with Copy /
Clear. The full file paths are shown beneath each row so users can find
them via OS file explorer if needed.

The Debug Mode toggle description now mentions wire capture, so it's clear
what gets enabled.

**File changed:** `styles.css` — new `.obsidianaitools-error-log-*` classes
for the modal and entry styling. No JS style manipulation (CLAUDE.md rule).

---

### 5. Unrelated lint fixes (path destructuring)

**Status**: ✅ Fixed

**Files changed:** `src/components/settings/AgentClientSettingTab.ts:856`,
`src/components/chat/AgentUpdateBanner.tsx:92`

Both had `const { join, dirname } = await import("path")` which ESLint's
`@typescript-eslint/unbound-method` rule flags (false positive — `path.join`
and `path.dirname` don't use `this`, but the rule can't tell that for
dynamic imports). Switched to `const path = await import("path")` + namespace
calls. Same behaviour, no lint errors.

---

### What this would have caught

For the original incident, opening **Settings → Diagnostics → View** would
have shown:

```json
{
  "timestamp": "2026-05-26T19:04:47.384Z",
  "source": "acp-prompt-error",
  "agentId": "claude-code-acp",
  "sessionId": "9fb51c59-2356-44f1-8d38-69796679ba4c",
  "message": "Internal error: API Error: The socket connection was closed unexpectedly...",
  "code": -32603,
  "errorKind": "unknown",
  "data": { "errorKind": "unknown" }
}
```

…instead of the misleading "Authentication Required" modal pointing the
user at their (working) API key. With debug mode on, the corresponding
outgoing `session/prompt` frame and any partial `session/update` chunks
would also be in `acp-wire.log` for the server owner to correlate against
proxy logs.

---

### Future work (not in this change)

- Improve error categorization in `message-service.ts:handleSendError()` so
  network/socket failures get their own "Connection Error" bucket instead
  of being miscategorized as auth. The logs now make this debuggable, but
  the *user-visible* message is still wrong on socket failures.
- Consider an in-app "Recent Errors" pill in the chat UI itself so users
  see the diagnostic count without opening settings.
