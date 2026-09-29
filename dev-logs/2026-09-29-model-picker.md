# Dev Log — 2026-09-29 — Show the model picker for claude-agent-acp

## Version: 1.0.5

---

### Context

Paul found a Polish Note run taking 8+ minutes in AI Tools versus 1:15 in
Claudian. The ACP wire log showed tool calls returning in 0.1–0.5 s, so the
time was all model turns. The session was on Opus: the plugin sends no model,
so Claude Code fell back to `"model": "opus"` in `~/.claude/settings.json`.
Claudian picks its own model (Sonnet).

There was no way to change it in the chat. The composer had no model chip:

- The dedicated model chip only renders from the legacy `models` session
  state. claude-agent-acp no longer sends it (`models: null` in
  `session/new`); the model is advertised only as a config option
  (`id: "model"`, `category: "model"`).
- The config-option chips skipped `category: "model"` on the assumption the
  dedicated chip covered it.

So neither chip rendered.

---

### Change 1: Only skip the mode/model config-option twins when their dedicated chip shows

**Status**: ✅ Done (pending Paul's in-Obsidian test)

`src/components/chat/ChatInput.tsx`

- `showModeChip` / `showModelChip` computed once and used both for rendering
  the dedicated chips and for filtering `visibleConfigOptions`.
- A `mode` or `model` config option is now hidden only while its dedicated
  chip is actually rendered. Agents that still send legacy `modes`/`models`
  look exactly as before; claude-agent-acp now gets a model chip from its
  config option.
- Mode and model config-option chips render without the `Name:` prefix
  ("Sonnet 5.5", not "Model: Sonnet 5.5"), matching the dedicated chips.
  Other options keep it ("Effort: High").

Selecting a value goes through the existing `onConfigOptionChange` →
`session/set_config_option` path, same as the effort chip.

---

### Change 2: Hide Fable from the model picker

**Status**: ✅ Done (pending Paul's in-Obsidian test)

`src/adapters/acp/acp-type-converter.ts` — `tidyModelOptions()`, applied
to the `category: "model"` option in `toSessionConfigOptions()`.

Fable costs far more than the other models for note work, so any model
option whose value or name matches `/fable/i` is dropped. It is kept when
it is already the current model, so the chip never shows a raw id.

Same place as the Fast Mode filter, so it covers session create, load,
resume, fork and `config_option_update`.

---

### Change 3: Consistent model names

**Status**: ✅ Done (pending Paul's in-Obsidian test)

The agent names some models with a version ("Sonnet 5.5", "Haiku 4.5") and
some without ("Opus", "Opus (1M context)"). `tidyModelOptions()` adds the
version from the description when the name lacks one:

| Agent name | Shown as |
|---|---|
| Opus | Opus 5.5 |
| Opus (1M context) | Opus 5.5 (1M context) |
| Sonnet 5.5 / Haiku 4.5 | unchanged |

The version is read from the start of the description ("Opus 5.5 · ...",
"Opus 5.5 with 1M context · ..."), and only inserted when the name starts
with the same family word. The "1M" in "(1M context)" is not treated as a
version. Verified against the option list from Paul's wire log.

---

### Not changed

- The plugin still does not choose a default model. The default comes from
  Claude Code settings; Paul's vault default is set via the vault's
  `.claude/settings.json` (personal config, not part of the plugin).
- The picked model is per session, not remembered across new chats.

---

### Change 4: Release v1.0.5, claude-agent-acp tested ceiling 0.79.0 → 0.84.0

**Status**: ✅ Done

Paul upgraded claude-agent-acp to 0.84.0 and ran three Polish Note sessions
on it with the model picker (Opus → Sonnet 5.5 switch, full skill run
including the Automation Log write) without issues.
`AGENT_MAX_TESTED_VERSIONS["claude-code-acp"]` raised to 0.84.0; version
bumped to 1.0.5 (manifest, package, versions.json).

---

### Change 5: Default model (Sonnet) and default permission mode (Accept edits)

**Status**: ✅ Done (pending Paul's in-Obsidian test)

The picker alone doesn't help users who never touch it: every new chat
still starts on the agent's choice, which for claude-agent-acp is the
user's Claude Code settings or, failing that, the agent's recommended
Opus (1M). Most users are likely on Opus in Manual mode without knowing.

- `src/plugin.ts` — two settings, `claudeDefaultModel` (default `"sonnet"`)
  and `claudeDefaultMode` (default `"acceptEdits"`). Empty string = "Use my
  Claude Code setting", i.e. don't touch the session. Existing installs pick
  up the defaults on load, so all users get Sonnet + Accept edits.
- `src/shared/session-defaults.ts` — `applySessionDefaults()` (pure,
  non-React). Model first (a model switch can rebuild the effort options),
  then mode. Each is applied through the config option of that category
  when the agent offers the value, otherwise through legacy
  `modes`/`models` (`setSessionMode`/`setSessionModel`). Values the agent
  doesn't offer, and failed requests, are skipped: the session still starts.
- `src/hooks/useAgentSession.ts` — `createSession()` marks the session
  ready at once with `selectSessionDefaults()` (the defaults shown on the
  chips), then runs `applySessionDefaults()` in the background and stores
  what the agent actually ended up with (a failed request reverts its
  chip; a result for a session the user already left is dropped). New
  chats only; load/resume/fork keep the session's own model and mode.
- `src/hooks/useChat.ts` — `sendMessage()` awaits
  `waitForSessionDefaults(sessionId)` after the user message and waiting
  indicator are shown and before the prompt goes out, so a first prompt
  can't run on the agent's own model/mode. Capped at 90 s.

  The wait is part of the in-flight send promise, so queueing and
  steering treat it like a running turn. Paul's test found a duplicate
  prompt: he pressed Stop while the message was waiting (Stop only
  cancelled on the agent, where nothing was running yet), the text was
  restored, he re-sent, and both prompts went out once the defaults
  landed. Now a waiting send carries a token; Stop clears it
  (`chat.cancelWaitingSend()` in `handleStopGeneration`) and a newer send
  replaces it, and the waiting prompt is dropped instead of sent.

  First build awaited the requests *before* marking the session ready.
  Paul's test: no chips at all for about a minute. Wire log: right after
  `session/new` the agent took 4.6 s to answer `model=sonnet` and 53 s to
  answer `mode=acceptEdits` (both succeeded). Manual switches later in a
  session answer in under a second, so the agent only answers once Claude
  Code has started behind it, which is slow through the gateway. Likely
  the same delay as the ~50 s "stall before the first reply" seen earlier.
  Hence ready-first, apply-in-background.

- **Start on the default model instead of switching to it.** Root cause of
  the 53 s mode wait, from the claude-agent-acp 0.84.0 source: on session
  creation (`register` phase) *and* after every model switch, the agent
  runs `refreshContextWindowInBackground()` → `query.getContextUsage()`, a
  control request to the Claude Code process. Control requests are
  serialized on one channel, so `setPermissionMode` (and, per the 10:32 run,
  the first prompt) queue behind it. The agent's own comments say
  getContextUsage "can add tens of seconds". Its session/create phases
  themselves take ~0.7 s (error.log stderr timings), so it isn't startup.
  Through the gateway today that check took ~50 s; this morning it was
  quick (10:01 run: first output 7 s after the prompt).

  `buildAgentConfigWithApiKey()` now sets `ANTHROPIC_MODEL` to
  `claudeDefaultModel` in the Claude agent's spawn env (unless the user set
  one in the agent's env vars). The agent ranks it above settings.json, so
  sessions start on the default model: no switch, no second
  getContextUsage. `applySessionDefaults()` then finds the model already
  selected and only switches the mode. The env is part of the spawn
  signature, so changing the setting restarts the agent on the next chat.

  The creation-time getContextUsage still runs on every new chat; that
  wait is on the gateway side (suspected slow token counting) and has been
  raised with its owner.
- `AgentClientSettingTab.ts` — "Default model" and "Default permission
  mode" dropdowns at the top of the Claude Agent section. Labels use
  version-free names ("Sonnet") because the `sonnet` alias tracks the
  latest release; the chat chip shows the exact version.
- Docs: `docs/usage/model-selection.md` and `mode-selection.md` document
  the defaults. The model page previously claimed the model was remembered
  across sessions, which wasn't true.

Why these defaults: Sonnet 5.5 did the same Polish Note job as Opus in a
third of the time. Accept edits lets the core job (editing notes) run
without prompts while shell commands still ask; Auto currently fails
through the gateway ("Classifier unavailable"), and Bypass is too
permissive as a default for everyone (the existing "Auto-allow
permissions" toggle stays opt-in for the same reason).

Verified `applySessionDefaults()` against a mock agent: defaults applied
via config options; "Use my Claude Code setting" and unknown values make no
calls; already-selected values aren't re-sent; legacy modes/models agents
use `setSessionMode`/`setSessionModel`.

---

### Change 6: Rotating words while waiting for the first output

**Status**: ✅ Done (pending Paul's in-Obsidian test)

`src/components/chat/ChatMessages.tsx` — the `waiting` phase label
("Starting...") sat unchanged for over a minute when the first reply was
slow, which looks frozen. It now cycles Claude Code-style words every 4 s
(`WAITING_WORDS`: "Thinking...", "Analyzing...", "Planning..." etc.; active-work words, not waiting words, per Paul), driven by the indicator's
existing 1 s elapsed tick. Other phases keep their labels. Deliberately
says nothing about the server (Paul's call: telling users it's slow
reads as cheap).

---

### Result

Same note, same Polish Note skill: 8+ minutes (Opus, cancelled) → 2:58 on
Sonnet 5.5 (edits applied at ~1:57). The remaining gap to Claudian (~1:15)
is on the gateway side (no prompt cache reads, one ~50 s stall before the
first reply) and has been raised with the gateway owner.
