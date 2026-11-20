# Dev Log — 2026-11-20 — Compat warning toggle, quick prompt auto-send, hidden chips, tested ceiling 0.109.0

## Version: 1.0.9

---

### Context

- The "newer than tested" warning remembers a dismissal per installed
  version. claude-agent-acp releases often, so the warning kept coming
  back after each update. Same problem the update banner had before 1.0.8.
- A send-immediately quick prompt fired on a new tab, before the agent
  session was ready, was dropped into the composer instead of sent.
- claude-agent-acp now offers "ultracode" (0.107+) and "agent" (new in
  0.108/0.109) config options. Both showed up as chips under the input.
- Paul tested claude-agent-acp 0.107.0, 0.108.1 and 0.109.0: no error log
  entries, no JSON-RPC errors.

---

### Change 1: "Untested version warnings" setting

**Status**: ✅ Done

- `src/plugin.ts` — new `showCompatWarnings: boolean` (default `true`),
  loaded with a type check like the other flags.
- `src/components/settings/AgentClientSettingTab.ts` — toggle under
  System status, below "Agent update notices". Roll back stays on the
  agent version rows.
- `src/components/chat/ChatView.tsx` — the version check skips the
  compatibility warning when the setting is off (setting is in the
  effect's deps).
- `src/components/chat/CompatWarningBanner.tsx` — new **Don't show
  again** button (`onDisable`) next to Dismiss. It turns the setting off.

---

### Change 2: Quick prompts auto-send on a new tab

**Status**: ✅ Done

- `src/hooks/useChat.ts` — `queueMessage(content, options, hold?)`:
  `hold` queues even when nothing is in flight. New `flushQueue()` sends
  the first queued message if no turn is in flight.
- `src/components/chat/ChatView.tsx` — effect calls `flushQueue()` when
  the session becomes ready to send (`isSessionReady` and not restoring
  history).
- `src/components/chat/ChatInput.tsx` — a send-immediately quick prompt
  fired before the session is ready is held in the queue (shown as a
  queued chip, removable with ×). Insert-mode prompts still go to the
  composer.

---

### Change 3: Hide "ultracode" and "agent" chips

**Status**: ✅ Done

`src/components/chat/ChatInput.tsx` — `HIDDEN_CONFIG_OPTION_IDS`
(`ultracode`, `agent`) are filtered out of the config option chips. Hidden
by id rather than an allowlist, so useful new options from any agent
still appear.

---

### Change 4: Tested ceiling

`src/shared/version-checker.ts` — `AGENT_MAX_TESTED_VERSIONS`
`claude-code-acp` 0.93.0 → 0.109.0. Gemini CLI unchanged (not tested).
