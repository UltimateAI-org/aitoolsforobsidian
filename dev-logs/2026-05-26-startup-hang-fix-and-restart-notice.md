# Dev Log — 2026-05-26 — Fix 10 s startup hang, restart notices & compat warning

## Version: 0.9.0 (patch)

---

### Context

Two issues reported after the 0.9.0 upgrade:

1. **Startup hang** — AI Tools took ~10 seconds to become usable every time
   Obsidian opened. The chat panel sat unresponsive while the plugin loaded.
2. **Restart not obvious** — The post-upgrade Notice said "open Settings to
   update the npm package" but never told the user to restart Obsidian. The
   new code only takes effect after a restart, so users were confused when
   changes didn't appear.

---

### 1. `commandExists` → `commandExistsAsync` (root-cause freeze fix)

**Status**: ✅ Fixed

**File changed:** `src/adapters/acp/acp.adapter.ts`

**Problem:** `commandExists()` used `spawnSync` — which **blocks the Node.js
event loop** (and therefore the Electron renderer) for its entire timeout
duration. On macOS/Linux it spawns a login shell (`-l` flag) that sources
`.zshrc`, `.nvm`, `.bashrc`, conda init, etc. On a typical developer machine
this easily takes 3–5 seconds and freezes the Obsidian UI completely while
`initialize()` runs during workspace restoration at startup.

**Fix:** Replaced with `commandExistsAsync()` using async `spawn` wrapped in
a Promise. Key design decisions:

- **Timeout resolves `true`** (not `false`): if the shell check times out we
  assume the command *might* exist and proceed. The real agent-spawn attempt
  will surface a meaningful error if the binary is actually missing. A
  false-positive is far safer than a false-negative here.
- **Reduced timeout 4000ms → 3000ms**: the async version doesn't block
  anything, but tighter is still better for UX.
- Removed the now-unused `spawnSync` import.

**Why the login shell is still needed:** Obsidian is a GUI app — its
inherited PATH from launchctl/Windows desktop doesn't include
`/usr/local/bin`, `~/.npm-global/bin`, or nvm-managed paths. The async check
uses the same login shell the agent-spawn itself uses, so both agree on
whether the binary is findable.

---

### 2. `runNpmListGlobal` and `runForVersion` timeouts halved

**Status**: ✅ Fixed

**File changed:** `src/shared/version-checker.ts`

| Function | Before | After |
|---|---|---|
| `runForVersion` (node/npm --version, npm root -g) | 5 000 ms | 3 000 ms |
| `runNpmListGlobal` (npm list -g --json fallback) | 10 000 ms | 5 000 ms |

These are async so they don't freeze the UI, but they do gate the version
check completion. The 10-second `runNpmListGlobal` was the worst case: if
none of the fast filesystem lookups succeeded, the version check hung for 10
seconds before showing (or not showing) the update banner. Halved to 5 s max
with no loss of functionality — npm responds well under that on any
reasonable machine.

---

### 3. Version-check effect delayed 3 s on startup

**Status**: ✅ Fixed

**File changed:** `src/components/chat/ChatView.tsx`

The agent npm-package version-check `useEffect` previously fired immediately
on mount. Even though the check itself is async, it spawns several child
processes (npm, where.exe/which, cmd.exe) right as the agent process is also
being initialised — adding process-spawn pressure during the most sensitive
moment of startup.

Added a `window.setTimeout(..., 3000)` around the entire async body. The
delay is cancelled cleanly on unmount and when the dependency array changes
(agent switch), so no stale checks can fire after the component tears down.

---

### 4. Persistent upgrade notice with "Restart Now" button

**Status**: ✅ Complete

**Files changed:** `src/plugin.ts`, `styles.css`

**Before:** 12-second auto-dismissing Notice that said:
> "AI Tools updated from v0.8.9 to v0.9.0. If Claude Agent fails to connect,
> open Settings → AI Tools to update the npm package."

No mention of restarting Obsidian.

**After:** Persistent Notice (timeout = 0, stays until dismissed) with:

```
✅ AI Tools updated v0.8.9 → v0.9.0
Restart Obsidian to apply the update.
[Restart Now]  [Later]
```

**Restart Now** calls
`app.commands.executeCommandById('app:reload')` — Obsidian's built-in
reload command. Falls back to `window.location.reload()` if the command
isn't available (edge case in older Obsidian versions).

**Later** dismisses the Notice without restarting.

The styled button row uses `mod-cta` on the primary button so it renders as
a highlighted action inside the notice, matching Obsidian's HIG for
primary/secondary controls. Corresponding CSS added to `styles.css`.

---

### 5. Restart Now after npm install (banner + settings)

**Status**: ✅ Complete

**Files changed:**
- `src/components/chat/AgentUpdateBanner.tsx`
- `src/components/settings/AgentClientSettingTab.ts`

After a successful `npm install`, both the chat-view Update button and the
Settings Update button previously showed a 4-second auto-dismissing Notice
with no call to action. Replaced with the same persistent Restart Now /
Later pattern used for plugin upgrades.

---

### 6. Auto-save command path after install (fixes stale settings on Linux/Mac)

**Status**: ✅ Complete (two iterations — see note below)

**Files changed:**
- `src/components/chat/AgentUpdateBanner.tsx`
- `src/components/settings/AgentClientSettingTab.ts`
- `src/shared/version-checker.ts` — exported `getNpmGlobalRoot`

**Problem (original):** After a successful `npm install -g`, the settings page
re-ran `checkAgentVersion` but the `commandPath` setting was still empty
(nothing was auto-saved). On Linux/Mac, detection falls through to
login-shell `which` + hardcoded paths. If the binary landed somewhere
not covered (e.g. nvm-managed node at `~/.nvm/versions/node/vXX/bin/`),
all paths miss and settings shows "Not installed" even though the install
succeeded.

**Fix (original):** After a successful install, `detectAgentPath()` is called and the
result is saved to `settings.<agent>.command` (only when no path was
previously configured — never overwrites a deliberate manual setting).
`runCheck()` then uses the fast `existsSync` path and reflects the real
installed state immediately.

**Problem (second iteration):** A user's saved command was the bare name
`"claude-agent-acp"` — no path separators. `existsSync("claude-agent-acp")`
always returns `false` (OS requires absolute or relative paths). The
auto-save only triggered when the command was completely empty, so a bare
name slipped through and `checkAgentVersion` continued failing the
`existsSync` step on every check.

**Fix (second iteration):**

Added `isBareCommand(cmd)` helper:
```typescript
private static isBareCommand(cmd: string): boolean {
    return !!cmd && !cmd.includes("/") && !cmd.includes("\\");
}
```

`autoSaveCommandPath()` now saves when `!cmd || isBareCommand(cmd)` — both
empty settings and bare-name settings are replaced with the resolved full path.

Added `detectPathFromNpmRoot(agentId)` as a two-step fallback when
`detectAgentPath()` (login-shell `which` + hardcoded dirs) returns nothing:
1. Run `npm root -g` (3 s timeout) → e.g. `/usr/local/lib/node_modules`
2. Derive bin dir:
   - Unix: `join(dirname(dirname(root)), "bin")` → `/usr/local/bin`
   - Windows: `dirname(root)` → `…\npm`
3. `existsSync(join(binDir, binaryName))` → save if found

`getNpmGlobalRoot` in `version-checker.ts` was made `export` so both
`AgentClientSettingTab` and `AgentUpdateBanner` can import and call it.

**Detection chain on Linux** (for reference when debugging):
1. `existsSync(savedCommandPath)` — skipped if empty or bare name
2. `detectAgentPath()`:
   a. `/bin/bash -l -c "which 'claude-agent-acp'"` via spawnSync
   b. `existsSync` on hardcoded paths: `/usr/bin/`, `/usr/local/bin/`, `~/.npm-global/bin/`
3. `detectPathFromNpmRoot()` fallback:
   a. `npm root -g` (async, 3 s timeout)
   b. `existsSync(join(binDir, binaryName))`
4. `npm list -g --json` (async, 5 s timeout — only in version-check path)

---

### 7. Agent compatibility version warning

**Status**: ✅ Complete

**Files changed:**
- `src/shared/version-checker.ts` — `AGENT_MAX_TESTED_VERSIONS` map,
  `isAboveTestedVersion` + `maxTestedVersion` added to `VersionInfo`
- `src/plugin.ts` — `compatWarningDismissed: Record<string, string>`
  added to settings
- `src/components/chat/ChatView.tsx` — `compatWarning` state,
  warning banner render
- `styles.css` — compat warning banner styles

**Motivation:** `claude-agent-acp` has already shipped one breaking change
(v0.37.0 rename + SDK bump). Future versions could change the ACP protocol,
rename methods, or add required auth flows — all of which would silently
break sessions with a confusing error.

**Design:**

A `AGENT_MAX_TESTED_VERSIONS` map in `version-checker.ts` records the
highest agent version explicitly verified with each plugin release:

```typescript
export const AGENT_MAX_TESTED_VERSIONS: Record<string, string> = {
    "claude-code-acp": "0.37.0",
    "gemini-cli":      "0.43.0",
};
```

When `checkAgentVersion` detects an installed version above the max
tested, it sets `isAboveTestedVersion = true`. ChatView shows a yellow
warning banner 3 seconds after startup (same delay as the update check):

> ⚠️ Claude Agent v0.38.0 is newer than the tested version (v0.37.0) —
> if you hit issues, check for a plugin update.  `[Dismiss]`

**Dismiss behaviour:** Dismissal is persisted to settings
(`compatWarningDismissed[agentId] = installedVersion`). The warning
won't reappear for that specific version across restarts — only if a
newer untested version is installed. This answers the "shows every
startup?" concern: no, once per installed version.

**Not a hard block:** The warning is informational only. Users can
still install/update/use the agent freely. It gives early signal to
report issues before assuming the plugin is broken.

**Workflow for maintainer:** When a new agent version ships and is
verified working, bump the one-liner in `version-checker.ts` and
ship a plugin update. If you don't test it, users see the yellow
warning and know to check for a plugin update before filing bugs.

---

### Files touched (full session)

```
M  src/adapters/acp/acp.adapter.ts    spawnSync → spawn (commandExistsAsync)
M  src/adapters/acp/acp.adapter.ts    spawnSync → spawn (commandExistsAsync)
M  src/components/chat/AgentUpdateBanner.tsx
                                      Restart Now after install,
                                      auto-save command path (empty + bare names),
                                      detectPathFromNpmRoot fallback
M  src/components/chat/ChatView.tsx   3-second delay on version-check effect,
                                      compatWarning state + banner render
M  src/components/settings/AgentClientSettingTab.ts
                                      Restart Now after install,
                                      autoSaveCommandPath() (empty + bare names),
                                      detectPathFromNpmRoot() fallback
M  src/plugin.ts                      persistent restart notice with button,
                                      compatWarningDismissed setting
M  src/shared/version-checker.ts      10s → 5s, 5s → 3s timeouts,
                                      AGENT_MAX_TESTED_VERSIONS,
                                      isAboveTestedVersion + maxTestedVersion,
                                      export getNpmGlobalRoot
M  styles.css                         upgrade-notice button-row styles,
                                      compat-warning banner styles
```

---

### Tested

- ✅ TypeScript build clean
- ✅ Windows — install, update banner, restart notice all working
- ✅ Linux — install succeeds, restart notice shows
- ✅ Linux — settings no longer stale (bare-name path fixed, npm root fallback)
- ✅ Rollback to 0.36.1 triggers update banner after 3 s

### Not yet tested

- Mac cold-start (login shell async path, auto-save after install)
- Compat warning banner end-to-end (requires agent version > 0.37.0)

---

**End of Log**
