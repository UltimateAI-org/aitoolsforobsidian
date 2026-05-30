# Dev Log — 2026-05-30 — Rollback recovery for untested agent versions

## Version: 0.9.1 (patch)

---

### Context

The 0.9.0 release shipped an "agent newer than tested" warning banner in the
chat view (the `isAboveTestedVersion` check). That banner correctly *flagged*
the risk — "claude-agent-acp v0.38.0 is newer than the tested version
v0.37.0" — but it told the user to "check for a plugin update" without
giving them any way to recover if they actually hit a regression.

Concretely:

- A user upgrades `claude-agent-acp` past the plugin's tested ceiling.
- The banner warns them, they dismiss it (or don't notice it among other
  notices), and carry on.
- Days later, a subtle protocol mismatch breaks a flow.
- Their only recovery options were "find the plugin's release notes" or
  "run an npm command yourself" — exactly the audience that won't open a
  terminal.

Worse, once the banner is dismissed the dismissal is persisted *per installed
version* (in `data.json` → `compatWarningDismissed`), so the warning — and
the implicit pointer to the agent version mismatch — vanishes permanently
for that exact version. The user who needs the recovery path most can't find
it.

This release closes that gap with a one-click rollback affordance, exposed
in two places so it survives banner dismissal.

---

### 1. `installAgent` now accepts a pinned version

**Status**: ✅ Done

**File changed:** `src/shared/agent-installer.ts`

`installAgent` previously hardcoded `@latest`. Added an optional fourth
parameter `version`; when supplied, the install command becomes
`npm install -g <pkg>@<version> --force`. The `--force` was already there
for upgrade/rename scenarios and conveniently also handles downgrade —
npm overwrites the newer tree with the pinned older one.

All existing callers (which omit the version) still resolve to `@latest`,
so update flows are unchanged.

---

### 2. Extracted `showAgentRestartNotice` helper

**Status**: ✅ Done

**File changed:** `src/shared/agent-installer.ts`

The "Restart Now / Later" persistent Notice was duplicated in three places
(`AgentUpdateBanner`, `AgentClientSettingTab.renderAgentVersionRow`, and was
about to be needed in the new rollback flow). Extracted into a single
`showAgentRestartNotice(plugin, titleText, bodyText?)` so the post-install
UX is identical across update, rollback, and any future installer-driven
flow.

Refactored both `AgentUpdateBanner` and the Settings tab's update path to
call the helper — net deletion of ~60 lines of DOM-building duplication.

---

### 3. `CompatWarningBanner` — chat-side rollback button

**Status**: ✅ Done

**File added:** `src/components/chat/CompatWarningBanner.tsx`
**Files changed:** `src/components/chat/ChatView.tsx`, `styles.css`

Replaced the inline compat-warning `<div>` in `ChatView` with a dedicated
component that mirrors `AgentUpdateBanner`'s structure. The banner now
exposes a `Roll back to v<maxTested>` button alongside `Dismiss`:

- Click → `plugin.disconnectAgentForFileOperation()` (releases the Windows
  file locks the running agent holds on its own binaries — otherwise npm
  fails with EPERM) → `installAgent(agentId, nodePath, output, maxTested)`
  → `showAgentRestartNotice`.
- After rollback the installed version equals `maxTested`, so
  `isAboveTestedVersion` becomes false on the next check and the banner
  auto-clears.
- The `onResolved` callback clears the banner state immediately on success
  so the user isn't staring at a stale warning waiting for the restart.

#### Styling

The original compat warning used `--background-modifier-warning` for the
full-width background with `--text-warning` for the message text. In many
Obsidian themes those two variables share the same yellow hue, which made
the warning message disappear — only the ⚠️ icon was visible against the
orange wall.

Redesigned to match `AgentUpdateBanner`'s container conventions:

- Subtle `--background-modifier-hover` background with rounded corners and
  inset margin (instead of full-width banner).
- 3px `--text-warning` **left border** as the warning cue.
- Message text uses `--text-normal` (readable against the subtle
  background regardless of theme).
- Rollback button uses Obsidian's `mod-cta` class for consistent
  high-contrast CTA styling across themes — `--interactive-accent` +
  `--text-on-accent` was too low-contrast in some themes for legible hover
  state.

---

### 4. Settings-tab rollback button

**Status**: ✅ Done

**File changed:** `src/components/settings/AgentClientSettingTab.ts`

`renderAgentVersionRow` now renders a second `Roll back to v<maxTested>`
button (hidden by default via the existing `obsidianaitools-hidden`
class — no inline `style.display`, satisfying
`obsidianmd/no-static-styles-assignment`). It becomes visible when the
version check reports `isAboveTestedVersion`.

When visible, the row description also gains a "Newer than tested
(vX.Y.Z)." suffix so the *why* is obvious without hunting through plugin
docs.

#### Why this is the more important of the two surfaces

The chat banner's dismiss state is per-installed-version and persisted.
A user who dismisses once never sees that banner again for that version,
even if they later hit problems. The Settings row, by contrast, is the
canonical "manage this agent" home and ignores the dismiss state — so
the rollback recovery path stays discoverable for the entire time the
user is above the tested ceiling.

#### Rollback handler

The Settings `runRollback` is a near-twin of the existing `runUpdate`,
but with `installAgent`'s new `version` parameter wired to
`currentMaxTested` (captured during the last `runCheck`). On success it
calls `autoSaveCommandPath` then `runCheck` — same post-install dance as
update — so the row state reflects the downgrade immediately.

---

### 5. Bumped `AGENT_MAX_TESTED_VERSIONS["claude-code-acp"]` 0.37.0 → 0.39.0

**Status**: ✅ Done

**File changed:** `src/shared/version-checker.ts`

Verified claude-agent-acp 0.38.0 and 0.39.0 work against the current
plugin code. Both bumped through 0.38.0 (briefly, to verify rollback UI)
then settled at 0.39.0. Gemini's tested ceiling remains at 0.43.0 (its
installed version on the test machine is 0.42.0, so still below).

---

### Summary

| Surface | Before | After |
|---|---|---|
| Chat banner copy | "check for a plugin update" | "roll back or check for a plugin update" + button |
| Chat banner visibility | Orange wall, message invisible in many themes | Subtle banner with warning-yellow left border, readable text |
| Settings → agent row | Update / Check again only | Adds "Newer than tested" suffix + "Roll back to vX" button when above tested |
| Recovery path | Edit `data.json` or run `npm install -g <pkg>@<version>` manually | One click |
| Restart notice | 30-line DOM-building block duplicated in 3 places | Single `showAgentRestartNotice` helper |
| `installAgent` | `@latest` only | Optional pinned version (used for rollback) |

The compat warning UX is now properly closed-loop: the banner explains the
risk *and* hands the user the recovery button, the Settings tab keeps the
recovery button reachable after dismissal, and both routes share the same
install + restart-notice flow.
