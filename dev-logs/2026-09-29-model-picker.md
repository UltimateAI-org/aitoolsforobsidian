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

### Result

Same note, same Polish Note skill: 8+ minutes (Opus, cancelled) → 2:58 on
Sonnet 5.5 (edits applied at ~1:57). The remaining gap to Claudian (~1:15)
is on the gateway side (no prompt cache reads, one ~50 s stall before the
first reply) and has been raised with the gateway owner.
