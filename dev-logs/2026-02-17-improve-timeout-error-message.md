# Development Log - February 17, 2026

## Session: Improve Timeout Error Message UX

**Agent**: Claude Code (Opus 4.6)
**Version**: 0.8.1

---

## Issue Description

When copying an Obsidian vault to a new machine without the ACP agent package installed (e.g., `@zed-industries/claude-code-acp`), the agent process spawns via Node.js but doesn't respond to the initialize request. After 30 seconds, a timeout error appears as a wall of unformatted text with no actionable guidance:

> "Agent initialization timed out after 30 seconds. The agent process spawned successfully (PID: 17668) but did not respond to the initialize request. This could indicate: 1) Missing or invalid API key/environment variables, 2) Agent waiting for authentication, 3) Network connectivity issues. Check the console logs for more details. Node version: v22.21.1, npm version: unknown"

The user has no idea they need to run `npm install -g @zed-industries/claude-code-acp` or `wsl --install`.

Meanwhile, the ENOENT / exit-code-127 error path already has good UX with structured messaging and an auto-install button. The timeout path needed similar treatment.

## Fix

### Changes

**`src/adapters/acp/acp.adapter.ts`**
- Replaced the single-line timeout error message (line ~486) with a structured, multi-line message.
- Dynamically builds context-aware bullet points:
  - For known agents (Claude Code, Gemini CLI, Codex): includes the exact `npm install -g ...` command.
  - On Windows with WSL mode enabled: hints that WSL may need installing with `wsl --install`.
  - Always includes generic causes: missing API key, network issues.
- Uses `\n` line breaks and bullet characters for readable formatting.

**`styles.css`**
- Added `white-space: pre-wrap` to `.obsidianaitools-chat-error-message` so newlines in error messages render as actual line breaks instead of collapsing into a single paragraph.

### Before vs After

**Before**: Single paragraph, no actionable steps, poor formatting.

**After**:
```
Agent initialization timed out after 30 seconds.

The agent process started but did not respond. Common causes:

* The agent package may not be installed. Run:
  npm install -g @zed-industries/claude-code-acp
* WSL may not be installed or configured. Run: wsl --install
* Missing or invalid API key/environment variables
* Network connectivity issues

Check the console logs (Ctrl+Shift+I) for more details. Node version: v22.21.1
```

## Version Bump

Bumped to 0.8.1 in `manifest.json`, `package.json`, and `versions.json`.

## Verification

- Build succeeds (`npm run build`).
- Error message renders with proper line breaks via `white-space: pre-wrap`.
- Known agent timeout includes install command; unknown agents omit it.
- Windows WSL hint only appears when WSL mode is enabled in settings.
