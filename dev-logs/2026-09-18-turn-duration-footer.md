# Dev Log — 2026-09-18 — Turn duration footer ("Completed in 42s")

## Version: 1.0.3 (patch, on top of 1.0.2)

---

### Context

The loading indicator shows a seconds counter while the agent works, but
it resets to zero on every phase change (`Pondering 8s` → `Responding
0s`) and disappears the moment the turn finishes. Nothing recorded when a
prompt started or ended, so there was no way to see how long a reply
actually took — the figure that matters when choosing an effort level.

Paul's request: keep the live counter, and tell the user how long the
whole prompt took once it's done.

---

### Change 1: Stop reason surfaced through the port

**Status**: ✅ Done (pending Paul's in-Obsidian test)

`IAgentClient.sendPrompt` returned `Promise<void>`; the ACP `stopReason`
was only logged. It now returns `PromptResult { stopReason? }`.

- `src/domain/models/chat-message.ts` — `PromptStopReason` (`end_turn |
  max_tokens | max_turn_requests | refusal | cancelled`), `TurnStats
  { durationMs, stopReason? }`, and `ChatMessage.turn?: TurnStats`.
- `src/domain/ports/agent-client.port.ts` — `PromptResult`; `sendPrompt`
  returns it.
- `src/adapters/acp/acp-type-converter.ts` — `toStopReason()` maps the
  ACP enum, unknown strings → `undefined`.
- `src/adapters/acp/acp.adapter.ts` — returns the converted reason; the
  two swallowed benign errors return `{}` (empty response) and
  `{ stopReason: "cancelled" }` (user aborted).
- `src/shared/message-service.ts` — `SendPromptResult.stopReason?`,
  populated at all three send sites.

### Change 2: Timing measured in useChat, stamped on the reply

**Status**: ✅ Done (pending Paul's in-Obsidian test)

`src/hooks/useChat.ts`:

- `turnStartedAt` state (epoch ms, `null` when idle), set alongside
  `isSending` when the prompt goes out, cleared when it settles or on
  `clearMessages`. Exported from the hook.
- `stampTurn()` — functional `setMessages` update that puts
  `{ durationMs, stopReason }` on the last message **if it is an
  assistant message**. A turn that errored before any output leaves no
  stamp (last message is the user's). A steered turn also leaves no
  stamp, because the new user message is already appended when the
  cancelled prompt resolves.
- Called when the prompt promise resolves (success or handled error) and
  in the unexpected-error catch. The prompt call resolving is the ACP
  turn boundary, so the measurement covers thinking, tool calls,
  permission waits and streaming — wall clock as the user experiences it.

### Change 3: Display

**Status**: ✅ Done (pending Paul's in-Obsidian test)

- `src/shared/format-duration.ts` (new) — `formatDuration(ms)` (`<1s`,
  `42s`, `1m 05s`, `1h 02m`) and `describeTurn(turn)`:
  `Completed in …` / `Stopped after …` (cancelled) / `Declined after …`
  (refusal) / `Hit limit after …` (max_tokens, max_turn_requests).
- `src/components/chat/MessageRenderer.tsx` — assistant messages with
  `turn` render a `.obsidianaitools-message-turn-stats` footer.
- `src/components/chat/ChatMessages.tsx` — `LoadingIndicator` now takes
  `turnStartedAt` and counts from it, so the live figure no longer resets
  per phase and agrees with the footer. Uses `formatDuration` so long
  turns read `2m 15s` rather than `135s`. Still hidden for the first 3 s.
- `src/components/chat/ChatView.tsx` — passes `turnStartedAt` through.
- `styles.css` — footer style: 0.75em, `--text-faint`, tabular digits.

**Persistence / export**: `saveSessionMessages` spreads the message, so
`turn` is saved and restored with no format change (session file stays
`version: 1`; old files simply lack the field). `chat-exporter.ts`
appends `*Completed in 42s*` under assistant messages that have it.

---

### Test plan

1. Send a prompt. Indicator shows `Starting… 3s`, then `Pondering… 7s`,
   `Responding… 12s` — the number keeps climbing across phases.
2. When the reply finishes, a faint `Completed in 14s` line appears under
   it and the indicator is gone. Number matches the last live figure.
3. Press Stop mid-turn: `Stopped after 6s`.
4. Restore the session from history: footers still present.
5. Export the chat: `*Completed in 14s*` under each assistant section.
6. Gemini/Codex: same behaviour (no agent dependency).
7. A turn over a minute reads `1m 05s` in both places.
