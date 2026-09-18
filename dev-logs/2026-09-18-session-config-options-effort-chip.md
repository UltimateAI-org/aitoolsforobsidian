# Dev Log — 2026-09-18 — Session config options (effort level chip)

## Version: 1.0.2 (patch, on top of v1.0.1)

---

### Context

Claude Code defaults to a high effort level (xhigh on Fable 5.1 and the
Opus 4.7+ family). That is tuned for long coding sessions and makes simple
vault tasks feel slow. Until now the only way to lower it from AI Tools
was to edit `~/.claude/settings.json` (`effortLevel` / `modelSettings`),
which most Obsidian users will never do.

`@agentclientprotocol/claude-agent-acp` (verified on 0.79.0) already
exposes effort as an ACP **session config option**: it sends an "Effort"
select in the newSession/load/resume/fork responses and on every
`config_option_update` notification, and accepts changes via
`session/set_config_option`. The ACP SDK we depend on (0.22.1) has
`setSessionConfigOption`. The plugin was dropping all of it — nothing read
`configOptions`, nothing handled the update, and the port had no setter.

Reference UI: Claudian's composer row (model chip, "Effort: High" chip,
YOLO toggle) — text chips that open a popup list rather than form selects.

---

### Change 1: Generic session config options end to end

**Status**: ✅ Done (pending Paul's in-Obsidian test)

Implemented generically, not effort-specific, so any select-type option
the agent advertises (today: Effort, and Fast mode on models that support
it) appears without further plugin changes.

**Domain**

- `src/domain/models/chat-session.ts` — new `SessionConfigOption` /
  `SessionConfigSelectOption`; `ChatSession.configOptions?`.
- `src/domain/models/session-update.ts` — new `ConfigOptionUpdate`
  (`type: "config_option_update"`) added to the `SessionUpdate` union.
- `src/domain/models/session-info.ts` — `configOptions?` on
  Load/Resume/Fork results.
- `src/domain/ports/agent-client.port.ts` — `configOptions?` on
  `NewSessionResult`; new `setSessionConfigOption(sessionId, configId,
  value)` returning the agent's reconciled option list.

**Adapter**

- `src/adapters/acp/acp-type-converter.ts` —
  `AcpTypeConverter.toSessionConfigOptions()`: keeps select-type options
  only, flattens grouped choice lists, nulls → undefined. Boolean options
  are not advertised as a client capability, so the agent degrades them
  to two-value selects (this is how Fast mode arrives).
- `src/adapters/acp/acp.adapter.ts` — maps `configOptions` in newSession,
  loadSession, resumeSession, forkSession; handles
  `config_option_update` in the `sessionUpdate` switch; implements
  `setSessionConfigOption` via `connection.setSessionConfigOption`.

**Hooks**

- `src/hooks/useAgentSession.ts` — `configOptions` in session state
  (reset on create/load/switchAgent, set from results);
  `updateConfigOptions()` for notifications; `setConfigOption()` with
  optimistic update, rollback on error, and adoption of the agent's
  returned list (a model switch can rebuild the effort choices).
  `updateSessionFromLoad` takes a fourth `configOptions` argument.
- `src/hooks/useSessionHistory.ts` — `SessionLoadCallback` gains
  `configOptions`; passed through on load/resume/fork.
- `src/hooks/useChat.ts` — `config_option_update` listed with the other
  session-level updates it intentionally ignores.

**View**

- `src/components/chat/ChatView.tsx` — routes `config_option_update` to
  `updateConfigOptions` (both during history replay and normally, like
  `current_mode_update`); passes `configOptions` /
  `onConfigOptionChange` to `ChatInput`.

---

### Change 2: Composer chips replace the native select dropdowns

**Status**: ✅ Done (pending Paul's in-Obsidian test)

New `src/components/chat/SessionOptionChip.tsx`: a button styled as a
text chip (`Effort: High ⌄`) that opens an Obsidian `Menu` anchored below
the chip, one item per value with a check on the current one. Theme-aware,
keyboard-navigable, no custom positioning or JS styles.

`ChatInput.tsx` now renders three kinds of chip in the actions row:

1. Mode (unchanged data source: `session.modes`)
2. Model (unchanged data source: `session.models`)
3. One chip per config option whose `category` is not `"mode"` or
   `"model"` (the agent also lists those two as config options; they are
   already covered by chips 1 and 2) and that has more than one value.

The imperative `DropdownComponent` lifecycle for mode/model (two effects
plus refs each, ~120 lines) is gone; the chips are plain React.

`styles.css`: `.obsidianaitools-mode-selector*` and
`.obsidianaitools-model-selector*` blocks replaced by a single
`.obsidianaitools-option-chip*` set. Value text uses `--text-accent` so
the current choice reads at a glance, as in the reference UI.

**Behaviour notes**

- Chips only render when the agent offers the option, so Gemini/Codex
  sessions show no effort control.
- The list is whatever the agent sends — the model's supported levels
  (`Low` … `Max`).
- Effort is per session and not persisted by the plugin. Persisting a
  user default would be a follow-up (write `effortLevel` via settings, or
  re-apply on session create).

---

### Change 3: Concrete default effort via the AIR `recommendedValue` capability

**Status**: ✅ Done (pending Paul's in-Obsidian test)

First test showed the chip as `Effort: Default`. "Default" means the
agent pins nothing and Claude Code resolves the level itself — xhigh on
Fable 5.1 / Opus 4.7+ / Sonnet 5 when no `effortLevel` is set. The agent
never reports the resolved value, so the plugin cannot show it, and the
whole point of the chip is to make the level visible and easy to lower.

`acp.adapter.ts` `initialize()` now advertises the JetBrains AIR
extension capability in `clientCapabilities._meta`:

```json
{ "jetbrains": { "air": { "version": 1, "capabilities": ["recommendedValue"] } } }
```

With that, claude-agent-acp (`buildEffortConfigOption` /
`clientSupportsRecommendedConfigValue`):

- drops the `Default` row from Effort (and Model);
- seeds Effort from the settings-file value if one is set
  (`modelSettings.<model>.effortLevel`, then `effortLevel`), otherwise
  from its recommendation — `medium` when the model supports it;
- applies that level to Claude Code via `applyFlagSettings` on session
  start and again after every model switch, so what the chip shows is
  what runs.

**Consequence for all users:** a fresh Claude session now runs at
**Medium** instead of Claude Code's xhigh default. That is the intended
product change — faster and cheaper for vault work, with higher levels
one click away. A user-level `effortLevel` in `~/.claude/settings.json`
still wins as the seed, so the settings-file override path is unchanged.
There is no longer a "let Claude Code decide" choice in the chip.

---

### Ceiling bump

`AGENT_MAX_TESTED_VERSIONS["claude-code-acp"]`: `0.76.0` → `0.79.0`.
The feature was built and verified by Paul against claude-agent-acp
0.79.0 on 2026-09-18, which covers 0.77.x–0.79.0.

### Rebased on v1.0.1

v1.0.1 shipped upstream on 2026-09-12 while this branch was in
progress. Fork `master` was fast-forwarded to `upstream/master`
(tag `v1.0.1`) and merged into this branch (`ed5aeaf`). The only shared
file, `acp.adapter.ts`, auto-merged cleanly: the stderr ring buffer from
1.0.1 and the `_meta.jetbrains.air` capability from this branch touch
different parts of `initialize()`.

Consequence: the red `[AcpAdapter] ... stderr:` console lines that
appeared during testing (the agent's `[session/create] phase=...`
timings) are gone in this build, because stderr is now debug-gated and
only persisted on process failure.

### Not done here

- `_auth/status_update` extension notification from the agent is not
  handled, so the ACP SDK logs "Method not found" to the console once
  per session. Pre-existing, harmless; a no-op `extNotification`
  handler would silence it.
---

### Test plan

1. Claude agent (0.79.0), new session: actions row shows Mode, Model,
   `Effort: Medium` chips (or your settings-file level if set). Open
   Effort → `Low / Medium / High / xHigh / Max` (set depends on model),
   current one checked; no `Default` row.
2. Pick `Low`, send a trivial prompt: noticeably faster; DevTools log
   shows `[AcpAdapter] Setting config option effort=low` and the
   returned list.
3. Switch model via the Model chip: Effort chip updates from the
   `config_option_update` the agent sends (levels may change per model).
4. Restore a session from history: chips reflect that session's values.
5. Switch to Gemini: no Effort chip; Mode/Model chips behave as before.
6. Opus model: a `Fast mode: Off` chip appears (two-value select); toggle
   works and the agent confirms.
