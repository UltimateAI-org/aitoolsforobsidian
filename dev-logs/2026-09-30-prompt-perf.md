# Dev Log — 2026-09-30 — Faster slash commands, fewer re-renders, agent notices

## Version: 1.0.6 (unreleased, branch `feat/prompt-perf`)

---

### Context

Paul is working on plugin speed. The ACP wire log for a `/polish-note` run
showed the prompt going out as:

```
[ "The user has opened the note …",  "@[[Waking Up]]\n/polish-note" ]
```

Claude Code only expands a slash command when the **last** prompt content
block is text starting with `/`. Here it wasn't, so the model had to load the
command itself with the Skill tool: one extra model round trip per command.

A probe that drives claude-agent-acp 0.84.0 directly measured it on a trivial
command:

| Layout | Expanded directly? | Total |
|---|---|---|
| `[ctx, "@[[note]]\n/cmd"]` (old) | No — "Load skill" call | 4.8–5.7 s |
| `[ctx, "/cmd"]` | Yes | 2.6–2.7 s |
| `["/cmd", ctx]` / `["/cmd", resource]` / `[resource, "/cmd"]` | No | ~5 s |

The resource cases fail because claude-agent-acp's `promptToClaude` moves
embedded Resource text to the end of the message.

---

### Change 1: Slash commands go last, on their own

**Status**: ✅ Done — tested in Obsidian (`/polish-note` 2m30s → 35s–1m39s; the
gateway's variance is part of that)

`src/shared/message-service.ts`

- `preparePrompt` routes slash commands (`message.startsWith("/")`) through
  the text-context path even when the agent supports embedded context, since
  Resource blocks would end up after the command.
- The text-context path, for slash commands, sends
  `[context text + @[[note]] prefix, …images, "/command args"]` — the command
  alone in the final block. Verified the expanded command still sees the
  note context.
- Duplicated auto-mention metadata code folded into `buildAutoMentionContext`.

---

### Change 2: Skip identical available_commands_update

**Status**: ✅ Done

`src/hooks/useAgentSession.ts`

claude-agent-acp sends the full command list (~90 commands, ~15 KB) twice per
prompt. `updateAvailableCommands` now returns the previous session state when
names, descriptions and hints are unchanged, so the duplicate no longer
re-renders the chat as the reply starts.

---

### Change 3: Agent notices shown as their own line

**Status**: ✅ Done (pending Paul's in-Obsidian test)

`src/adapters/acp/acp.adapter.ts`, `src/domain/models/session-update.ts`,
`src/domain/models/chat-message.ts`, `src/hooks/useChat.ts`,
`src/components/chat/MessageContentRenderer.tsx`, `src/shared/chat-exporter.ts`,
`styles.css`

claude-agent-acp sends warnings (e.g. the auto-mode classifier billing notice,
model fallback) as a `notice` update only to clients advertising
`session.notices`. We can't advertise it: the ACP SDK 0.22 schema rejects
unknown `sessionUpdate` types, so the notice would be dropped. The fallback is
an `agent_message_chunk` of `**Title:** text`, which merged into the reply
text mid-sentence ("…classifier-billingNow the enhance-step rules").

- `isAgentNotice()` in the adapter: `_meta.claudeCode.kind === "informational"`,
  or a `**Title**`-led chunk with no `messageId` (model chunks always have
  one). Verified on a live frame through the gateway.
- New `agent_notice` session update → new `notice` message content, always
  pushed as its own item (never merged into text).
- Rendered as a muted line with a warning-coloured left border; exported as a
  `[!warning] Notice` callout.
- The gateway variant of Claude Code's "auto mode … no longer charge for
  classifier requests" notice ("your requests go through <host>") is hidden
  (`isGatewayClassifierNotice`, logged in debug mode). Only the gateway
  operator can act on it; the gateway owner confirmed it's cosmetic. Other
  notices still show.

---

### Findings outside the plugin

- **Gateway caching** (probe, trivial prompt, vault cwd): direct Claude login
  answers in 1.2–2.5 s with cache reads on every call; the gateway takes
  7–13 s on every session's first prompt (never cached, no cache writes) and
  2.4–7 s on follow-ups even when cached. That's ~40–60 s of a polish run.
- **"Always allow" missing**: claude-agent-acp offers "don't ask again" only
  when Claude Code suggests a reusable rule; long piped shell commands get
  none. Not a plugin issue.
