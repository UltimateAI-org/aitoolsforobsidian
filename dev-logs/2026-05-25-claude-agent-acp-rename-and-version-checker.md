# Dev Log — 2026-05-25 — claude-agent-acp rename migration & version checker UI

## Version: 0.8.9 → 0.9.0

---

### Context

User updated their global npm install of the Claude ACP agent. The package
had been renamed — both the binary (`claude-code-acp` → `claude-agent-acp`)
and the SDK (`@agentclientprotocol/sdk` had a breaking version bump from
`0.17.1` → `0.22.1`). The plugin broke on session creation with a confusing
"ACP connection closed" error. Investigation surfaced a second, broader
problem: the plugin had no upgrade UX for users on outdated agent versions
and no visibility into installed node/npm/agent versions.

This session fixes the immediate breakage and adds a version-checker UI
plus end-to-end upgrade affordances.

---

### 1. Fixed: session creation broken after agent npm update

**Status**: ✅ Fixed

**Files changed:**
- `package.json` — `@agentclientprotocol/sdk` `^0.17.1` → `^0.22.1`
- `src/adapters/acp/acp.adapter.ts` — renamed `unstable_resumeSession` →
  `resumeSession` (SDK method rename); removed a misguided gateway
  authenticate call (see "Red herrings" below)
- `src/plugin.ts` — added `migrateClaudeCommand()` that rewrites stale
  `claude-code-acp` references (bare names AND full paths with `.cmd`/
  `.ps1`/no extension) to `claude-agent-acp` on settings load
- `src/components/settings/AgentClientSettingTab.ts` — dropdown labels no
  longer expose the internal agent ID (`claude-code-acp`), which was
  misleading after the binary rename

**Root cause:** The new `claude-agent-acp@0.37.0` package shipped breaking
SDK changes AND renamed its binary. Users whose settings had the old
command path got "ACP connection closed" because cmd.exe couldn't find
`claude-code-acp.cmd` (it's now `claude-agent-acp.cmd`). The error message
was a downstream symptom — the agent process never started.

**Why the regex migration** (`plugin.ts:78-83`): handles three saved-value
shapes — bare `claude-code-acp`, full path like
`C:\…\npm\claude-code-acp.cmd`, and full path with no extension. Lookahead
`(?=\.|$)` ensures we don't accidentally rewrite directory components
that contain the substring.

---

### 2. Cross-platform pre-flight binary check

**Status**: ✅ Complete

**Files changed:**
- `src/adapters/acp/acp.adapter.ts` — new `commandExists()` method runs
  before spawn
- `src/shared/path-detector.ts` — `detectAgentPath` now uses
  `getEnhancedWindowsEnv` on Windows and a login shell on macOS/Linux to
  match the actual spawn flow

**Why:** Without pre-flight, a missing binary surfaces as "ACP connection
closed" on Windows (cmd.exe returns exit 1, not POSIX 127). The existing
exit-127 handler only fired on Unix. Users upgrading from older plugin
versions would hit this if they hadn't reinstalled the npm package yet.

**Critical cross-platform detail:** Mac/Linux Obsidian is a GUI app — its
inherited PATH from launchctl typically does NOT include `/usr/local/bin`
or `~/.npm-global/bin`. Running `which <agent>` against `process.env.PATH`
gives false negatives. The pre-flight (and path detector) must route
through `bash -l` / `zsh -l` so shell-config PATH entries are visible.
This mirrors what `AcpAdapter.initialize()` does at spawn time, so the
check and the actual spawn agree on whether the binary is findable.

---

### 3. One-time post-upgrade Notice

**Status**: ✅ Complete

**Files changed:**
- `src/plugin.ts` — added `lastSeenPluginVersion` to settings;
  `maybeShowUpgradeNotice()` runs on plugin load

**Tricky case:** A user upgrading from v0.8.9 → v0.9.0 has no
`lastSeenPluginVersion` (the field didn't exist in 0.8.9). Naively
treating "missing field" as "fresh install" suppresses the notice for
every existing user. The fix: check for prior-usage signals
(`hasCompletedOnboarding`, configured Claude command, or saved sessions).
Empty `lastSeenPluginVersion` + no usage signals = fresh install (stay
quiet); empty `lastSeenPluginVersion` + any usage signal = upgrade from a
pre-tracking version (show notice).

---

### 4. System Status section in Settings

**Status**: ✅ Complete

**Files changed:**
- `src/components/settings/AgentClientSettingTab.ts` —
  `renderSystemStatusSection()` near the top of settings
- `src/shared/version-checker.ts` — added `getNodeVersion`,
  `getNpmVersion`, expanded `VersionInfo` with an `isInstalled` boolean

**Layout decision:** node and npm get version-only rows (no Update
button) per user instruction — bumping those mid-session can break the
wider toolchain. Agents get full Install/Update affordances because each
is a single package the plugin owns end-to-end. Codex is hidden from the
section until it's general-use ready.

**Why `isInstalled` is separate from `installed` version string:**
package metadata goes missing in surprisingly common scenarios — partial
installs, npm registration getting corrupted (the user's VM had
`@agentclientprotocol/claude-agent-acp@` with an empty version), custom
prefixes. Treating "version unreadable" as "not installed" is wrong
because the binary still works. So:
- `isInstalled` = binary exists on disk (cheap, reliable)
- `installed` = version string from package.json (best-effort, often null)
- `isOutdated` = stays false unless both versions known

The UI uses `isInstalled` to decide Install vs Update affordances and
falls back to omitting the "from" version when we can't read it.

---

### 5. Agent-version detection — four fallback paths

**Status**: ✅ Complete

**Files changed:**
- `src/shared/version-checker.ts` — `getInstalledVersion` and
  `getInstalledVersionFromCommandPath`

The fallback chain (each tried until one returns a version):

1. **Configured command path** → adjacent or shim-resolved package.json
2. **Auto-detected binary path** → same lookup
3. **Hardcoded npm-prefix candidates** (`%APPDATA%\npm\node_modules`,
   `/usr/local/lib/node_modules`, `/opt/homebrew/lib/node_modules`,
   `~/.npm-global/lib/node_modules`)
4. **`npm root -g`** → most authoritative, but slow (spawns a process)

**Windows `.cmd` shim parser** (the breakthrough for the user's VM):
On Windows the shim file content contains a quoted path of the form
`%dp0%\node_modules\<package>\<entry-point>`. We read the file, regex out
that path, substitute `%dp0%` with the .cmd's parent directory, then walk
up from the entry point looking for a `package.json` whose `name` matches.
Works regardless of where npm actually installed the package — follows
the shim's own pointer to the truth.

---

### 6. Chat-view "Update available" banner

**Status**: ✅ Complete

**Files changed:**
- `src/components/chat/AgentUpdateBanner.tsx` — new component
- `src/components/chat/ChatView.tsx` — wires version check + banner render
- `styles.css` — banner styles

**Behavior:** Banner appears below ChatHeader when the active agent's
binary exists on disk AND a newer version is published on npm. Update
button runs the same `installAgent` flow as Settings. Dismiss button
hides the banner for the React-mount lifetime, scoped by version
(`<agentId>@<version>`) — so dismissing for 0.37.0 doesn't suppress the
banner for a future 0.38.0.

**Honest message text** when installed version unknown: "Claude Agent:
update available — v0.37.0" (no "from" version). When known: "Claude
Agent update available: 0.18.0 → 0.37.0".

---

### 7. Update flow: disconnect-then-install

**Status**: ✅ Complete

**Files changed:**
- `src/plugin.ts` — new `disconnectAgentForFileOperation()` method
- `src/shared/agent-installer.ts` — install command now uses
  `<pkg>@latest --force`
- `src/components/settings/AgentClientSettingTab.ts` —
  `runUpdate` is now async, awaits disconnect before npm
- `src/components/chat/AgentUpdateBanner.tsx` — same disconnect-first
  pattern in `handleUpdate`

**Root cause for original `EEXIST` and `EPERM` failures:**
- `EEXIST`: plain `npm install -g <pkg>` refuses to overwrite an existing
  `.ps1` / `.cmd` shim. Fixed with `--force`.
- `EPERM: operation not permitted, rmdir ...node_modules\@babel\runtime`:
  the agent process holds OS file handles on its own binaries and
  dependencies while running. Windows can't replace a file in use. Fixed
  by disconnecting the agent (kills the child process) and waiting 750ms
  before invoking npm.

Both issues were invisible until we captured the full npm output to the
dev console (previously we only saw the last chunk of stdout, truncated
to 200 chars).

---

### 8. Auto-deploy improvements

**Status**: ✅ Complete

**Files changed:**
- `esbuild.config.mjs` — now copies `main.js`, `manifest.json`,
  `styles.css` to each configured vault (was main.js only)

**Why:** Bumping the manifest version or changing styles wouldn't reach
the local vaults without this — those would silently drift out of sync.

---

### Red herrings worth recording

These soaked up significant session time before being eliminated. Avoid
repeating:

1. **Gateway authenticate() call.** I added a `connection.authenticate({
   methodId: "gateway", _meta: { gateway: { headers: { Authorization:
   "Bearer <key>" } } } })` call after `initialize()`, thinking the new
   agent required it. The opposite was true — calling it makes the agent
   force `ANTHROPIC_AUTH_TOKEN=" "` on Claude CLI's environment, which
   makes Claude CLI emit its own empty `Authorization: Bearer ` header
   that arrives at the gateway before our intended one. The gateway sees
   the empty Authorization and returns 401. The actual fix was to NOT
   call authenticate at all — the user's `ANTHROPIC_AUTH_TOKEN` env var
   already flows through `process.env` to Claude CLI just like before.

2. **WHATWG stream wrapping.** I swapped hand-rolled `ReadableStream`/
   `WritableStream` wrappers for Node's `Readable.toWeb`/`Writable.toWeb`
   thinking the Chromium globals were closing stdin prematurely. They
   weren't. The actual bug at the time was the binary path being stale.
   The stream switch is still in the tree (it's cleaner code), it just
   wasn't the fix.

3. **`npm list -g --depth=0 --json` parsing.** Spent time on robust
   multi-`{` JSON parsing because npm deprecation warnings could pollute
   the output. Then the user's VM had `@agentclientprotocol/claude-agent-
   acp@` registered with NO version, so npm itself couldn't report what
   we needed. The lesson: `isInstalled` (binary on disk) is the only
   reliable "is this here?" signal; version detection is best-effort.

---

### Files touched

```
M  .claude/settings.local.json
M  esbuild.config.mjs
M  manifest.json                              0.8.9 → 0.9.0
M  package.json                               sdk 0.17.1 → 0.22.1, version 0.9.0
M  src/adapters/acp/acp.adapter.ts            unstable_resumeSession rename,
                                              removed gateway authenticate,
                                              toWeb stream wrappers,
                                              always-on stderr logging,
                                              pre-flight commandExists()
M  src/components/chat/ChatView.tsx           agent version-check effect,
                                              banner render
M  src/components/settings/AgentClientSettingTab.ts
                                              System Status section,
                                              renderAgentVersionRow,
                                              renderEnvVersionRow,
                                              disconnect-then-install flow,
                                              cleaned dropdown labels
M  src/plugin.ts                              migrateClaudeCommand,
                                              lastSeenPluginVersion,
                                              maybeShowUpgradeNotice,
                                              disconnectAgentForFileOperation
M  src/shared/agent-installer.ts              @latest + --force
M  src/shared/path-detector.ts                enhanced PATH (Win) +
                                              login shell (Mac/Linux) in
                                              detectAgentPath
M  src/shared/version-checker.ts              getNodeVersion, getNpmVersion,
                                              4-step fallback chain,
                                              Windows .cmd shim parser,
                                              VersionInfo.isInstalled
M  styles.css                                 agent-update-banner styles
M  versions.json                              + 0.9.0
+  src/components/chat/AgentUpdateBanner.tsx  new component
```

---

### 9. Lint cleanup

**Status**: ✅ Complete (errors); ⏸ deferred (warnings)

**Files changed:**
- `esbuild.config.mjs` — `/* global console */` so the new auto-deploy
  `console.log`/`console.warn` calls don't trip `no-undef`. Used
  `/* global */` (not `/* eslint-env node */`) because ESLint's flat
  config dropped support for env directives.
- `src/adapters/acp/acp.adapter.ts` — `let env` → `const env` in
  `commandExists` (only properties mutate); broadened the eslint-disable
  block around the `Readable.toWeb` / `Writable.toWeb` casts to cover
  `no-unsafe-call` and `no-unsafe-member-access` (the methods exist at
  runtime in Node 17+ but lag in `@types/node`).
- `src/shared/path-detector.ts` — moved `readFileSync` to the top-level
  fs import (was a `require()` inside the function); removed an
  unnecessary `!` non-null assertion on `defaultVersion` (TS narrows it
  via the truthy check).
- `src/shared/version-checker.ts` — replaced `fetch()` with Obsidian's
  `requestUrl()` per the `no-restricted-globals` rule. Same behavior,
  just routed through Obsidian's HTTP wrapper.

**Sentence-case warnings (91 remaining):** deferred to a separate
follow-up PR. Audit showed roughly 60% are legitimate Obsidian-HIG
violations (`"API Key"` → `"API key"`, etc.) and 40% are false positives
(proper nouns like "Claude Agent", "Windows Subsystem for Linux",
URLs). Doing them properly needs per-string review which is a different
kind of work than this PR. Warnings don't block CI or the community
plugin store.

---

### Tested

- ✅ Pauls Obsidian — connection works, banner shows on outdated agent
- ✅ VM with `claude-agent-acp@0.18.0` — System Status displays correctly,
  Update flow succeeds (disconnect → install --force → success)
- ✅ All 4 deploy vaults: main.js + manifest.json + styles.css in sync at
  v0.9.0
- ✅ TypeScript build clean
- ✅ ESLint: 0 errors (91 pre-existing UI-style warnings, untouched)

### Not yet tested

- Mac/Linux upgrade path — relies on the login-shell pre-flight matching
  spawn behavior; behavior should be equivalent but unverified end-to-end
- Fresh-install (no settings) → onboarding → install button flow on
  Windows; relies on existing install affordances that weren't touched
  in this session

---

**End of Log**
