# Dev Log — 2026-07-03 — Code-review fixes + onboarding overhaul

## Version: 0.9.4 (patch)

---

### Context

A full code review of the plugin surfaced a cluster of related bugs — the
biggest being that settings changed in the settings tab never reached the
React chat view, and that a changed API key could never apply to an
already-running agent process. Separately, the onboarding modal reopened on
every vault load because dismissing it (X / Close) never wrote
`hasCompletedOnboarding`.

Also relevant: claude-agent-acp 0.54.1 is misbehaving, so we're deliberately
staying on 0.50.0 (`AGENT_MAX_TESTED_VERSIONS` ceiling). The update banner
used to nudge users toward the untested 0.54.1 anyway — fixed below.

---

### Onboarding: dismiss once, re-run from settings

**Status**: ✅ Done

**Files changed:** `src/components/OnboardingModal.ts`,
`src/components/settings/AgentClientSettingTab.ts`

- `onClose()` now marks `hasCompletedOnboarding = true` on *any* dismissal
  (X, Esc, button) via `saveSettingsAndNotify`, with a Notice pointing at
  the re-run option. Previously only completing/skipping the flow wrote the
  flag, so the modal reopened on every vault load.
- Removed the redundant "Get Started" button on step 1 — clicking an agent
  card already auto-advances, so the button was never meaningfully clickable.
- Bottom "Close" renamed to "Skip for now" (honest about the consequence).
- New "Setup wizard → Re-run setup" button at the top of the settings tab as
  the escape hatch.

Side effect (accepted): after dismissal, ChatView no longer skips session
creation, so an unconfigured agent shows the "Command Not Configured" error
with its working Install button — arguably better guidance than silence.

---

### Settings tab: saves now notify the settings store

**Status**: ✅ Done

**File changed:** `src/components/settings/AgentClientSettingTab.ts`

The tab mutated `plugin.settings` and called `plugin.saveSettings()`
directly — skipping the store notification that `useSettings` /
`useSyncExternalStore` depend on. React kept rendering a stale snapshot, so
API key, auto-allow, auto-mention, max lengths, WSL mode etc. silently never
reached the chat view.

All 41 call sites now go through a private `saveAndNotify()` helper that
calls `plugin.saveSettingsAndNotify({ ...settings })` (new object reference →
snapshot identity changes → React re-renders). The tab's own store
subscription only refreshes the agent dropdown, so per-keystroke notifies do
NOT re-render the tab or steal input focus.

---

### API key / base URL / model changes now actually apply

**Status**: ✅ Done

**Files changed:** `src/hooks/useAgentSession.ts`,
`src/components/chat/ChatView.tsx`

Env vars (ANTHROPIC_AUTH_TOKEN etc.) only apply at process spawn, but
`createSession()` skipped `initialize()` whenever the same agent was already
initialized — so a changed API key was never applied until an agent switch or
Obsidian restart.

- `useAgentSession` now tracks a spawn-config signature
  (command/args/env JSON) from the last successful `initialize()`. If the
  current config differs, `needsInitialize` is true and the process is
  respawned (applies to both `createSession` and `loadSession`).
- ChatView's settings-reload effect is now debounced (2 s) and skips the
  mount run. The settings tab saves per keystroke; without the debounce each
  keystroke would respawn the agent. Reload fires when the session is
  `ready` **or** `error` (so a corrected key recovers an errored session).

---

### Send errors no longer silently re-send the prompt

**Status**: ✅ Done

**File changed:** `src/shared/message-service.ts`

`handleSendError` treated *every* unrecognized error as an auth failure:
with one auth method it re-authenticated and re-sent the prompt. Transient
errors therefore executed the prompt twice (including tool side effects) and
reported "Authentication Required" for e.g. network errors.

New `isAuthErrorLike()` gate: JSON-RPC -32000 (ACP `auth_required`), 401, or
auth-ish message text. Everything else returns a plain "Message Send Failed"
error with the real message, no resend.

---

### Permission handling: no more opposite-action fallbacks

**Status**: ✅ Done

**Files changed:** `src/hooks/usePermission.ts`,
`src/adapters/acp/acp.adapter.ts`

- `selectOption` no longer falls back to `options[0]` — the reject hotkey
  could select an "Allow" option (and vice versa). Approve additionally
  matches option names containing "allow"/"yes"; no match → no action.
- Adapter auto-allow: reads `plugin.settings.autoAllowPermissions` live
  (was snapshotted at `initialize()`, so toggling mid-session did nothing)
  and only auto-responds when a genuine allow option exists — otherwise it
  falls through to the manual permission UI instead of blindly picking
  `options[0]` (which could auto-reject, or crash on an empty list).

---

### Update banner: untested-version wording + persisted dismissal

**Status**: ✅ Done

**Files changed:** `src/shared/version-checker.ts`,
`src/components/chat/ChatView.tsx`,
`src/components/chat/AgentUpdateBanner.tsx`, `src/plugin.ts`

Design goal: don't nag users who deliberately rolled back after a broken
agent release (0.54.1), don't hide new versions entirely (the maintainer
needs to see them to know there's something to test), and keep the user's
choice to update.

- New `VersionInfo.latestAboveTested` — true when the npm registry's latest
  is newer than `AGENT_MAX_TESTED_VERSIONS`.
- When true, the banner still shows but with honest wording — "vX is
  available but not yet tested with this plugin (tested up to vY)" — and an
  "Update anyway" button instead of "Update".
- Banner dismissals are now **persisted per version** in a new
  `agentUpdateDismissed` settings map (previously an in-memory Set that
  reset on every view remount, so rollback users were re-nagged on every
  open). Dismiss 0.54.1 once → silent until a different latest appears.
- Compat-warning dismissal switched to `saveSettingsAndNotify` for
  consistency with the store-notification fix.

---

### Smaller correctness fixes

**Status**: ✅ Done

- **`useChat` state mutation** (`src/hooks/useChat.ts`):
  `updateLastMessage` / `updateUserMessage` shallow-copied the message but
  mutated the shared `content` array — impure updater (duplicate chunks if
  React re-executes it) and retroactive mutation of saved snapshots. Now
  copies the array.
- **Init-timeout leak** (`src/adapters/acp/acp.adapter.ts`): the 30 s init
  timeout was only cleared on success; on fast failure it fired later as an
  unhandled rejection. Now cleared in `finally`, plus a guard for
  late `initPromise` rejections after a timeout win.
- **Windows PATH casing** (`src/shared/windows-env.ts` + callers):
  `process.env` spreads to a plain object keyed `Path` on Windows; writing
  `env.PATH` created a duplicate key and the nodePath prepend could silently
  not apply. New `getPathKey()` / `prependToPath()` used by
  `getEnhancedWindowsEnv`, the ACP adapter, `version-checker`, and the
  onboarding installer.
- **WSL command escaping** (`src/shared/wsl-utils.ts`,
  `terminal-manager.ts`, `acp.adapter.ts`): the command was interpolated raw
  into `bash -l -c`. New `escapeCommand` param — the adapter always escapes
  (single executable path), the terminal manager escapes only when args are
  provided (no-args commands may be full command lines the shell parses).
- **New chat as retry** (`src/components/chat/ChatView.tsx`): "New chat"
  with zero messages used to bail with "Already a new session" even when the
  session was in an error state; now it only bails when the session is
  `ready`, so it doubles as a retry button.
- **README**: supported Node range corrected to 22.x–25.x
  (claude-agent-acp `engines: node >=22`); 18.x contradicted the new
  System-Status warning.

---

### Not committed

Working tree intentionally left uncommitted — the 0.9.4 node-version-warning
work (see 2026-06-27 log) is still in progress in the same tree.
