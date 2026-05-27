# Dev Log — 2026-04-24 — Onboarding signup hint

## Version: dev

---

### 1. Add signup hint to onboarding Step 1

New users landing on the agent selection screen had no indication that an account or API key was needed before they could proceed.

**Files changed:**
- `src/components/OnboardingModal.ts`

**Details:**
- Added a tip paragraph below "Select an AI agent to use:" in `renderStep1()`
- Text: "You'll need an API key to get started. Sign up at obsidianaitools.com to create an account."
- Link opens `https://obsidianaitools.com` in a new tab
- Uses existing `obsidianaitools-onboarding-tip` CSS class to match Step 2 styling

**Why:**
- Users were selecting an agent, advancing to Step 2, and only then discovering they needed to create an account — causing drop-off
- Surfacing the signup link on Step 1 sets expectations before any selection is made

---
