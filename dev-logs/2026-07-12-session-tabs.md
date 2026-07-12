# Development Log - 2026-07-12

## Session: Parallel Session Tabs (numbered strip)

**Duration**: ~1.5 hours
**Version**: 0.9.5 (unreleased change)
**Agent**: Claude Code (Fable 5)

---

## 🎯 Features Implemented

### 1. Session Tabs (Claudian-style numbered strip)
**Status**: 🚧 In Progress (awaiting local testing)

Run up to **4 parallel agent sessions** in one chat panel, switched via a
numbered chip strip in the header (top-left, sharing the row with the
existing header buttons — placement per Paul's call, modeled on Claudian).

**UX:**

- Numbered chips (1…4) + a **+** chip; + hides at the cap (MAX_TABS = 4 —
  each tab is a live agent process, a few hundred MB each).
- Click a chip to switch; **right-click closes** the tab (tooltip says so).
- Busy dot (accent color, top-right of chip) while that tab's agent works.
- Closing the last tab replaces it with a fresh one — the panel always has
  at least one session.
- New Chat button keeps its meaning: reset the *current* tab.
- Closing a tab unmounts its instance → existing React cleanup runs
  (auto-export if enabled, closeSession, process kill).

**Architecture — the cheap path:**

`ChatComponent` already creates its entire world per instance (adapter,
agent process, hooks). New `TabbedChat` container mounts one instance per
tab and toggles visibility with CSS (`display: contents` for the active
pane so flex sizing is untouched; `display: none` for hidden). No changes
to `useChat` / `useAgentSession`; per-tab transcript, queue, and streaming
state come free because instances never unmount while their tab is open.

- `ChatView.tsx`: `TabbedChat` (tabs/activeTabId/busyMap state, MAX_TABS);
  `ChatComponent` gains `isActiveTab`, `tabStrip`, `onBusyChange` props;
  all four global workspace-event handlers (toggle-auto-mention,
  new-chat-requested, approve/reject-permission, cancel-message) are gated
  on `isActiveTab` so palette commands hit only the visible tab; busy
  state reported up via `isSending` effect. `onOpen` mounts `TabbedChat`.
- `ChatHeader.tsx`: `TabStripTab`/`TabStripState` types + chip strip
  rendered left of the title; each visible instance renders the strip from
  shared container state (only one instance is visible at a time).
- `styles.css`: tab pane visibility, chip styling on `--interactive-*`
  variables, busy dot.

### 2. CRITICAL fix: per-tab agent processes (adapter was a singleton)

First test pass surfaced "Session Creation Failed: ACP connection closed"
on closing the last tab. Root cause was architectural: `ChatComponent`
obtained its adapter via `plugin.getOrCreateAdapter()` — a **plugin-level
singleton** — so all tabs shared one process, one connection, and one
`onSessionUpdate` callback (last-mounted tab would receive every tab's
updates; any tab's disconnect killed the rest).

Fix: adapters are now per-instance. `plugin.createAdapter()` news up an
adapter per tab and tracks it in a `Set`; `releaseAdapter()` +
`disconnect()` run on instance unmount. Plugin-lifecycle code
(quit/unload cleanup, `disconnectAgentForFileOperation` for agent updates)
iterates the registry so every tab's process is handled.
`getOrCreateAdapter()` is gone.

### 3. UX adjustments (Paul's test feedback)

- Sole remaining tab can't be closed (right-click is a no-op) — avoids the
  teardown/respawn cycle entirely; New Chat is the reset gesture.
- Strip moved out of the header into its own slim row directly above the
  chat area (Claudian placement; earlier next-to-title looked detached).
- Chips: rounded corners (8px), active tab = accent background with
  on-accent text; hover changes background only, never text color.
- Quick-prompt chips lightened (`--background-modifier-hover` resting,
  `--interactive-hover` on hover) so they don't dominate; auto-mention
  badge rounded into a pill.

**Deferred (deliberately):** tab persistence across Obsidian restarts, tab
naming/renaming, drag reorder, per-tab notifications.

**Known trade-offs:** N tabs = N agent processes and N startup version
checks; inactive tabs keep their DOM alive (memory for long transcripts);
session history save/load acts on whichever tab is visible.

**Accepted cost (Paul, 2026-07-12):** hidden tabs keep re-rendering while
streaming (display:none skips paint, not computation) — 3 parallel
sessions pegged Paul's GPU and he decided to keep it: expected behavior
for parallel agents, bounded by MAX_TABS=4. If it ever matters, the fix
is pausing markdown rendering for hidden tabs (accumulate raw text,
render on switch) — do not add that complexity preemptively.

### Also in this session
- Chip colors moved to `--interactive-hover` (default) /
  `--interactive-normal` (hover) after `--background-modifier-*` proved
  invisible in Paul's theme; same for queued-chip ×.
- Stop no longer drops the message queue (suspendQueueFlush): chips stay,
  nothing auto-sends off a cancel, queue resumes after the next turn.
- Quick prompts settings nav row: whole row clickable + chevron, no count.

## 🔙 Rollback

Queueing + quick prompts are committed (38ec9c1, 674b29d — local only,
not pushed). Tabs + this session's fixes are uncommitted on top:
`git restore src/components/chat/ChatView.tsx src/components/chat/ChatHeader.tsx src/hooks/useChat.ts styles.css dev-logs/`
then `npm run build`. Binary backup of pure 0.9.5 remains in
`D:\Pauls Obsidian\.obsidian\plugins\obsidianaitools\backup-v0.9.5-pre-steering\`.

## 🧪 Testing

1. Reload → panel shows chip "1" + "+". Click + → tab 2 opens with a fresh
   session; agent selector, mode, queue all independent per tab.
2. Ask tab 1 something long, switch to tab 2 mid-stream → tab 1 chip shows
   busy dot; its answer keeps streaming in the background; switch back and
   the transcript is intact (scroll position too).
3. Palette commands (cancel message, approve permission, toggle
   auto-mention, new chat) only affect the visible tab.
4. Right-click chip 2 → closes, process exits (check with Task Manager if
   inclined); closing the last tab yields a fresh empty session.
5. + disappears at 4 tabs.
6. Queue + quick prompts still work per tab.
