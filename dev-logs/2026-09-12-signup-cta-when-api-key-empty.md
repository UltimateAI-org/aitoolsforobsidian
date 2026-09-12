# Dev Log — 2026-09-12 — Sign-up call to action when API key is empty

## Version: 1.0.0

---

## 🎯 Feature

### Sign-up button in settings
**Status**: ✅ Done (awaiting local testing)

A new install has no API key, which is the one state where the plugin
cannot do anything at all. Settings previously only offered written
instructions ending at "For more details on getting a subscription please
visit …", buried below the key field. Now an empty key surfaces a direct
call to action.

**Behaviour:**

- Shown directly under the API key field, **only while the key is empty**
- Name: "Don't have an account?" / Desc: "Sign up to get your API key and
  start using AI Tools in your vault."
- CTA button "Sign up" opens <https://obsidianaitools.com/> in the browser
- Disappears the instant a key is typed — the visibility sync runs from
  the API key field's `onChange`, so no settings re-render is needed
  (a full `display()` per keystroke would be both wasteful and jarring)

**Implementation** — `src/components/settings/AgentClientSettingTab.ts`:

- New module constant `SIGNUP_URL`
- `signupSetting` + `syncSignupVisibility(apiKey)` declared before the API
  key field so its `onChange` can toggle the prompt; the prompt itself is
  created immediately after the field, and `syncSignupVisibility` is
  called once on render to set the initial state
- Visibility uses the existing `.obsidianaitools-hidden` utility class
  (already in `styles.css`) via `toggleClass`, rather than inline styles —
  keeps to the "styles in CSS only" rule in CLAUDE.md
- No new CSS, no new strings beyond the two UI labels; lint warning count
  unchanged at 35

**Not changed:** the existing written instructions and the subscription /
support links stay as they are, and `OnboardingModal` is untouched — the
first-run wizard already walks users through obtaining a key.

## 🧪 Testing

The button is hidden whenever a key is present, so testing it means
clearing the field:

1. Settings → AI Tools → clear the API key field → the "Don't have an
   account?" row appears immediately, without reopening settings
2. Click **Sign up** → <https://obsidianaitools.com/> opens in the browser
3. Type any value into the key field → the row disappears immediately
4. Reopen settings with a key set → row is absent; with the key cleared →
   row is present on first render
