# Dev Log — 2026-09-20 — Hide the "Fast Mode" config option

## Version: 1.0.4 (no bump)

---

### Context

The session config chips (see the effort chip dev-log) render whatever
select options the connected agent advertises. Against the
`chat.ultimateai.org` gateway the agent advertises a "Fast Mode" option.
Paul tested it: with Fast Mode on, the response was slower, and one
request hit a Cloudflare 524 (120 s origin timeout) on the gateway. The
option does not do what its name promises, so it is hidden.

The plugin has no Fast Mode logic of its own. It only forwards the
selected value to the agent, so hiding the chip is the whole fix.

---

### Change 1: Drop Fast Mode in the ACP type converter

**Status**: ✅ Done (pending Paul's in-Obsidian test)

`src/adapters/acp/acp-type-converter.ts` — `toSessionConfigOptions()`
skips any select option whose `id` or `name` matches
`/fast[\s_-]?mode/i`.

This is the single place every config option list passes through
(session creation, load, resume, fork and `config_option_update`), so one
filter covers every path. The effort chip and any other option are
untouched.

The match is a regex rather than one hardcoded id because the id string
is chosen by the agent, not this plugin.

---

### Not changed

- The generic config option mechanism stays. It powers the effort chip.
- No version bump. This ships with the next release.
