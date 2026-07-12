# Development Log - 2026-07-12

## Session: Quick Prompts (settings-managed)

**Duration**: ~1.5 hours
**Version**: 0.9.5 (unreleased change, stacked on same-day queueing change)
**Agent**: Claude Code (Fable 5)

---

## 🎯 Features Implemented

### 1. Quick Prompts
**Status**: 🚧 In Progress (awaiting local testing)

Reusable prompts managed in settings (Paul's call: settings-based rather
than a vault folder — matches the existing "Add custom agent" pattern, no
vault opinion, no file watching). Fired three ways… two for v1:

1. **Chips above the composer** — one button per configured prompt, in
   settings-list order. Click fires it.
2. **`!` menu** — typing `!` at the very start of the composer opens the
   same SuggestionDropdown used by `@` and `/`, filtered by prompt name.
   (`!` mid-sentence never triggers.)
3. Command-palette command — deferred, not in v1.

**Behavior:**

- `sendImmediately: true` (default): firing sends right away; if the agent
  is streaming, it goes through the new message queue instead.
- `sendImmediately: false`: firing inserts the prompt text into the
  composer for editing. Also the fallback whenever the session isn't ready.
- Prompt text goes through the normal `prepareMessage` pipeline, so
  `@[[wikilink]]` mentions inside prompts resolve to note paths, and
  auto-mention still attaches the active note.
- Chips/menu only show prompts with both a name and prompt text.
- Placeholder gains ", ! for prompts" when any prompts are configured.

**Implementation:**

- `src/plugin.ts` — `QuickPromptSetting` (`id`, `name`, `prompt`,
  `sendImmediately`); `quickPrompts: QuickPromptSetting[]` in settings +
  defaults + `loadSettings` normalization (per-item validation, generated
  ids for malformed entries).
- `src/components/settings/AgentClientSettingTab.ts` — "Quick prompts"
  section between Mentions and Display: add/delete, name field, prompt
  textarea, send-immediately toggle, up/down reorder (list order = chip
  order). Modeled on `renderCustomAgents`.
- `src/hooks/useQuickPrompts.ts` — new hook mirroring `useSlashCommands`
  (trigger `!` at input start, filter by name, navigate/close). Does NOT
  touch auto-mention (unlike slash commands) — prompts want note context.
- `src/components/chat/SuggestionDropdown.tsx` — third dropdown type
  `"quick-prompt"` (name + prompt preview line).
- `src/components/chat/ChatInput.tsx` — `fireQuickPrompt` callback; chip
  strip render; `!` dropdown render; third branch in
  `handleDropdownKeyPress`; `updateSuggestions` call in
  `handleInputChange`.
- `styles.css` — `obsidianaitools-quick-prompt-strip/-chip`, theme
  variables only.

### 3. Meta Bind-style manager sub-page (second test pass)

Replaced the collapsible in-page editor with a dedicated sub-page, modeled
on Meta Bind's "Input field templates" flow (Paul's request):

- Main settings shows one row: "Prompts — N prompts >" button.
- Clicking it swaps the settings container to a manager page: back arrow +
  title, "Prompts" heading with a **+** extra button (top right), and one
  row per prompt (name + truncated prompt preview).
- Row actions: pencil → edit in `QuickPromptEditModal` (draft copy, Save /
  Cancel); × → delete; grip handle → HTML5 drag-and-drop reorder (drag armed
  only while the handle is pressed).
- `showQuickPromptsPage` flag routes `display()`; reset in `hide()` so
  reopening settings lands on the main page. Fixes the delete-jumps-to-top
  issue as a side effect (old delete handler used a raw `display()`).
- Chip styling inverted per feedback: default = hover treatment
  (`--background-modifier-hover` + `--text-normal`), hover = darker; same
  inversion for the queued-chip × button.

### 2. Settings UX fixes (from Paul's first test pass)

- **Defensive Add handler**: self-heals a missing `quickPrompts` array
  (running settings object can predate the feature when the plugin updates
  without a full reload) and surfaces failures as a Notice + console error
  instead of dying silently.
- **Scroll preservation**: add/delete/reorder no longer jump the settings
  page to the top — `refreshDisplay()` captures and restores the scroll
  offset around the full `display()` re-render.
- **Collapsible section**: the prompt list folds into a
  "Manage quick prompts (N)" `<details>` disclosure so it doesn't dominate
  the settings page; open state survives refreshes within the session.

## 🔙 Rollback

Stacked on the uncommitted queueing change — the working tree now holds
both features; `git restore` of the changed files rolls back both:
`src/hooks/useChat.ts`, `src/hooks/useQuickPrompts.ts` (delete, untracked),
`src/components/chat/ChatInput.tsx`, `src/components/chat/ChatView.tsx`,
`src/components/chat/SuggestionDropdown.tsx`,
`src/components/settings/AgentClientSettingTab.ts`, `src/plugin.ts`,
`styles.css`, then `npm run build`.
Pure v0.9.5 binary backup remains in
`D:\Pauls Obsidian\.obsidian\plugins\obsidianaitools\backup-v0.9.5-pre-steering\`.

## 🧪 Testing

1. Settings → AI Tools → Quick prompts → Add quick prompt; name it
   "Summarize", prompt "Summarize the key points of this note as a bullet
   list.", leave Send immediately on.
2. Chip appears above composer; with a note open, click it → sends with
   auto-mention context.
3. Type `!sum` in the composer → dropdown filters; Enter fires.
4. Toggle Send immediately off → firing inserts text into composer instead.
5. Fire a chip while the agent is streaming → message queues (chip strip
   from the queueing feature) and sends when the turn ends.
6. Reorder via up/down arrows in settings → chip order follows.
7. Prompt containing `@[[Some Note]]` → agent receives the note content.

## 📋 Related discussion (same session)

- Multi-session: decided to explore **multiple Obsidian leaves** (a "New
  AI Tools chat" command opening additional ChatView leaves) before any
  in-panel tab strip. Claudian's numbered-chip strip is the fallback
  model if leaves feel clunky; Agent Console's full tab machinery is out
  of scope.
- Composer YOLO toggle (surface `autoAllowPermissions` next to the model
  selector) noted as a cheap future win.
