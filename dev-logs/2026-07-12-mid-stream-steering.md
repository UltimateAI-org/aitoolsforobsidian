# Development Log - 2026-07-12

## Session: Message Queueing While Streaming (+ internal steer support)

**Duration**: ~2 hours
**Version**: 0.9.5 (unreleased change)
**Agent**: Claude Code (Fable 5)

---

## 🎯 Features Implemented

### 1. Queue Messages While the Agent Is Streaming
**Status**: 🚧 In Progress (awaiting local testing)

Typing a message and pressing Enter while the agent is still responding now
**queues** it: the message shows as a removable chip above the composer and
auto-sends when the current turn finishes. This matches Claude Code / Cursor
semantics (Paul's call: "queueing makes more sense as that's what claude
code does"). An earlier iteration of this session implemented
cancel-then-redirect (steer) on Enter; that was reworked to queueing, but
the steer plumbing remains internally (see below).

**UX rules:**

- Streaming + content typed: Enter/send button queues; button shows a send
  arrow with a "Queue message" tooltip. Multiple messages can queue; they
  send one per turn, in order.
- Streaming + empty composer: button stays the stop square; Enter does
  nothing (an empty Enter must never trigger stop).
- Queued chips render above the composer (below the image strip); × removes
  a chip.
- Stop keeps the queue (revised after Paul's testing — the original
  drop-on-stop design silently lost queued items beyond the first). An
  explicit stop suppresses the flush for that settlement only
  (`suspendQueueFlush`), so nothing auto-sends off the back of a cancel;
  chips stay visible, × removes them, and the queue resumes after the next
  sent message completes. Last user message still restored to composer.
- New chat / session restart clears the queue (`clearMessages`).

**Implementation:**

- `src/hooks/useChat.ts`
  - New `QueuedMessage` model (`id`, `content`, `options` captured at queue
    time, including images and auto-mention context).
  - `queuedRef` (source of truth) + `queuedMessages` state (UI mirror);
    exposed `queueMessage`, `removeQueuedMessage`, `takeQueuedMessages`.
  - `queueMessage` sends immediately if nothing is in flight — closes the
    race where the turn settles between the UI reading `isSending` and the
    queue call (otherwise the message would sit unflushed forever).
  - Flush: in `sendMessage`'s `finally`, when the settling op is still the
    current one (identity check), shift the next queued item and send it
    via `sendMessageRef` (self-reference kept current each render).
  - Steer guard retained from the first iteration: if `sendMessage` is
    called while a prompt is in flight (e.g. the send-from-permission path),
    it cancels the turn and awaits settlement (bounded 5 s) before sending —
    ACP requires the previous prompt call to resolve first.
- `src/components/chat/ChatInput.tsx`
  - New props: `onQueueMessage`, `queuedMessages`, `onRemoveQueuedMessage`.
  - `handleSendOrStop`: stop only when streaming with an empty composer;
    with content it clears the composer and queues (streaming) or sends.
  - Enter handler: `isSending ? hasContent : !isButtonDisabled`.
  - Queued-chip strip rendered next to the image preview strip.
  - Hoisted shared `hasContent`; merged the two icon-update effects.
- `src/components/chat/ChatView.tsx`
  - `handleQueueMessage` captures options like `handleSendMessage`.
  - `handleStopGeneration` takes the queue before cancelling and prefers
    queued text for composer restore.
- `styles.css`: `obsidianaitools-queued-strip/-chip/-chip-label/-chip-remove`
  using theme variables.
- No adapter changes: `AcpAdapter.sendPrompt` already swallows "user
  aborted" errors, and `cancel()` resolves pending permission requests.

**Known limitation:** a queued message's images are included when it sends,
but the chip preview shows text only.

## 🔙 Rollback

- Change is uncommitted on `master`. Roll back with:
  `git restore src/hooks/useChat.ts src/components/chat/ChatInput.tsx src/components/chat/ChatView.tsx styles.css`
  then `npm run build` to redeploy the clean 0.9.5 to the vaults.
- Belt-and-braces: pre-change deployed files are backed up in
  `D:\Pauls Obsidian\.obsidian\plugins\obsidianaitools\backup-v0.9.5-pre-steering\`.

## 🧪 Testing

Manual test plan in `D:\Pauls Obsidian`:

1. Ask something long-winded; while it streams, type a second question and
   press Enter → chip appears; when the first answer finishes, the second
   sends automatically and both are answered in order.
2. Queue two messages → they send one per turn, in order.
3. Press × on a chip → it's removed and never sends.
4. While streaming with a queued chip, click stop → generation stops,
   nothing auto-sends, queued text lands back in the composer.
5. Streaming + empty composer: Enter does nothing; stop square works.
6. Normal send/stop flows unchanged when idle.
