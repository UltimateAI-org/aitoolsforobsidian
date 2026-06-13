# Dev Log — 2026-06-13 — Bump Claude ACP tested ceiling to 0.44.0

## Version: 0.9.2 (patch)

---

### Context

`@agentclientprotocol/claude-agent-acp` has shipped through to **0.44.0**
on npm since the 0.9.1 release set the tested ceiling at 0.39.0. Users on
any 0.40.x – 0.44.x install were getting the compat warning banner — and
the matching settings-row "Newer than tested" suffix + rollback button —
for no real reason: the protocol has been compatible the whole time, and
those versions have been exercised against this plugin without issue.

Without a bump, those users were being nudged toward an unnecessary
rollback. That's the opposite of what the warning is for, so this release
just moves the ceiling forward.

---

### 1. `AGENT_MAX_TESTED_VERSIONS["claude-code-acp"]` 0.39.0 → 0.44.0

**Status**: ✅ Done

**File changed:** `src/shared/version-checker.ts`

Only the constant changed. The downstream effects flow automatically from
the existing 0.9.1 plumbing:

- Chat-side `CompatWarningBanner` won't appear for 0.40.x – 0.44.x
  installs (`isAboveTestedVersion` becomes false).
- Settings → Claude Agent row drops the "Newer than tested" suffix and
  hides the rollback button via `obsidianaitools-hidden`.
- If `claude-agent-acp` ships 0.45.x next, the banner returns with
  "Roll back to v0.44.0" — same code path, no further changes needed.

Gemini's ceiling stays at 0.43.0 (Gemini-side installs on the test
machine remain below it).

---

### 2. `.gitignore`: ignore local `PR_DRAFT.md`

**Status**: ✅ Done

**File changed:** `.gitignore`

`PR_DRAFT.md` is now a per-release scratchpad used to draft the upstream
PR body. Added to `.gitignore` so it stays a local working file across
releases without polluting `git status`.

---

### Summary

Pure constant bump for `claude-code-acp` from 0.39.0 → 0.44.0, plus a
trivial `.gitignore` entry for the PR-draft scratch file. No behavior
changes, no UI changes — the 0.9.1 banner + rollback infrastructure
correctly self-resolves for the now-trusted version range.
