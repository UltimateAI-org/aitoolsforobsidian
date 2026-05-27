# Dev Log — 2026-03-28 — Linux improvements, nvm support, package rename, UI polish

## Version: v0.8.9

---

### 1. Migrated agent package from `@zed-industries/claude-agent-acp` to `@agentclientprotocol/claude-agent-acp`

The `@zed-industries/claude-agent-acp` npm package was deprecated and renamed to `@agentclientprotocol/claude-agent-acp`.

**Files changed:**
- `src/shared/agent-installer.ts`
- `src/shared/path-detector.ts`
- `src/adapters/acp/acp.adapter.ts`
- `src/components/OnboardingModal.ts`
- `src/components/settings/AgentClientSettingTab.ts`

**Details:**
- All install command strings updated to new package name
- `@agentclientprotocol/sdk` was already migrated in a previous release

---

### 2. Linux: Flatpak/Snap sandbox detection

GUI apps running inside a Flatpak or Snap sandbox cannot access npm or Node.js from the host system. The onboarding now detects this and shows a clear warning with distro-specific reinstall instructions instead of silently failing.

**Files changed:**
- `src/shared/path-detector.ts` — added `detectSandboxEnvironment()` function
- `src/components/OnboardingModal.ts` — shows warning in Step 3 when sandboxed

**Detection:**
- Flatpak: checks `process.env.FLATPAK_ID`
- Snap: checks `process.env.SNAP` / `process.env.SNAP_NAME`

**Warning content:**
- Explains sandbox isolation prevents npm/node access
- Distro-specific reinstall instructions:
  - Arch Linux: `sudo pacman -S obsidian`
  - Debian / Ubuntu / Mint: download `.deb` from obsidian.md/download (note: site defaults to AppImage, scroll down for .deb)
  - Fedora / other: download `.AppImage` from obsidian.md/download

**Why AppImage vs .deb matters:**
- obsidian.md detects Linux but not the specific distro, so defaults to AppImage
- Mint/Debian/Ubuntu users should use `.deb` — double-click install, no extra steps
- AppImage requires `chmod +x` before it can run
- Snap and Flatpak are sandboxed and block host npm/node access

---

### 3. Linux: Node.js detection improvements

Node.js detection failed on Debian/Ubuntu/Mint and for nvm users.

**Files changed:**
- `src/shared/path-detector.ts`

**Fixes:**
- On Debian/Ubuntu/Mint, `apt install nodejs` installs the binary as `nodejs` not `node`. Detection now tries both `which node` and `which nodejs`.
- Added `/usr/bin/nodejs` and `/usr/local/bin/nodejs` to common Linux paths fallback.
- Added nvm detection: GUI apps don't inherit shell PATH, so `which node` fails even when nvm is configured. Now scans `~/.nvm/versions/node/` for installed versions, preferring the default alias, falling back to latest.

---

### 4. Linux: nvm npm install fix

When node is installed via nvm, `npm` is also only available via nvm's PATH setup in `.bashrc`. Obsidian as a GUI app doesn't source `.bashrc`, so `npm` was not found during agent installation.

**Files changed:**
- `src/shared/agent-installer.ts`

**Fix:**
- Prepends `. "$HOME/.nvm/nvm.sh"` to the install command on macOS/Linux:
  ```bash
  [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"; npm install -g ...
  ```
- This is a no-op if nvm is not installed.

---

### 5. Linux: Distro-specific Node.js install commands in onboarding

Previously the onboarding showed a generic "Node.js and npm installed (nodejs.org link)" message. For Linux users without Node.js, this was not actionable.

**Files changed:**
- `src/components/OnboardingModal.ts`

**Details:**
- When Node.js is not detected on Linux, shows copyable terminal commands for each distro:
  - Arch Linux: `sudo pacman -S nodejs npm`
  - Debian / Ubuntu: `sudo apt install nodejs npm`
  - Fedora: `sudo dnf install nodejs npm`
- When Node.js IS detected, shows "✓ Node.js detected: /path/to/node" and hides install instructions entirely.

---

### 6. Onboarding code blocks now selectable

The `obsidianaitools-onboarding-error-codeblock` CSS class was referenced in the code but had no definition in `styles.css`, so code blocks had no styling and were not selectable.

**Files changed:**
- `styles.css`

**Added:**
```css
.obsidianaitools-onboarding-error-codeblock {
    user-select: text;
    cursor: text;
    ...
}
```

---

### 7. UI polish

**Files changed:**
- `src/components/chat/ChatView.tsx` — `getDisplayText()` changed from "Agent client" to "AI Tools"
- `src/plugin.ts` — ribbon icon tooltip capitalised from "AI tools" to "AI Tools"
- `src/components/OnboardingModal.ts` — "Next: Base URL ←" button renamed to "Next: Setup Agent ←"

---

### 8. React Error Boundary

The entire React tree is mounted via `this.root.render(<ChatComponent/>)`. If any child component throws an unhandled error during render (e.g. malformed diff from agent, unexpected null), the Obsidian view turns completely blank with no recovery.

**Files changed:**
- `src/components/ErrorBoundary.tsx` (new) — React class component with `getDerivedStateFromError` / `componentDidCatch`
- `src/components/chat/ChatView.tsx` — wraps `<ChatComponent />` in `<ErrorBoundary>`
- `styles.css` — fallback UI styling

**Details:**
- Catches render errors and shows "Something went wrong" with the error message
- "Restart Session" button resets the error state to recover without reloading Obsidian

---

### 9. Timer cleanup in TerminalManager

When the plugin is disabled/re-enabled quickly, stale `setTimeout` references from terminal cleanup could fire against destroyed objects.

**Files changed:**
- `src/shared/terminal-manager.ts`

**Details:**
- Added `activeTimeouts` Set to track all `setTimeout` IDs
- `trackTimeout()` / `clearTrackedTimeout()` helper methods manage the Set automatically
- `killAllTerminals()` now clears all tracked timeouts as a safety net after iterating terminals

---

### Version bump

- **v0.8.9** — All entries above (Linux improvements, nvm support, package rename, UI polish, stability fixes)
