# Dev Log — 2026-10-20 — Agent update notices toggle, tested ceiling 0.93.0

## Version: 1.0.8

---

### Context

claude-agent-acp publishes new versions often. The chat's update banner
remembers a dismissal per version, so each new release brought the banner
back and Dismiss felt like it only lasted the session. Users had no way to
turn it off for good.

Paul tested claude-agent-acp up to 0.93.0 with no regressions, so the
tested ceiling moves up.

---

### Change 1: "Agent update notices" setting

**Status**: ✅ Done

- `src/plugin.ts` — new `showAgentUpdateNotices: boolean` (default
  `true`), loaded with a type check like the other flags.
- `src/components/settings/AgentClientSettingTab.ts` — toggle under
  System status, below the Node.js and npm rows. The agent version rows
  still show installed vs latest with an Update button either way.
- `src/components/chat/ChatView.tsx` — the version check skips the update
  banner when the setting is off; the setting is in the effect's deps so
  toggling it takes effect without reopening the view.
- `src/components/chat/AgentUpdateBanner.tsx` — new **Don't show again**
  button (`onDisable`) next to Dismiss. It turns the setting off.

The compatibility warning (installed version newer than tested) is not
affected. It already shows only once per installed version.

---

### Change 2: Tested ceiling

`src/shared/version-checker.ts` — `AGENT_MAX_TESTED_VERSIONS`
`claude-code-acp` 0.84.0 → 0.93.0. Gemini CLI unchanged (not tested).
