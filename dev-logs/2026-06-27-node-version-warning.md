# Dev Log — 2026-06-27 — Node.js version warning in System Status

## Version: 0.9.4 (patch)

---

### Context

A user noticed they were running Node.js v25.4.0 — a development/Current release
that went EOL around mid-2026 — with no indication from the plugin that anything
was wrong. The System Status panel showed "Installed: 25.4.0" and nothing more,
while Claude Agent already had a "Newer than tested" warning for similar situations.

Node.js versioning: even majors (22, 24, 26…) become LTS; odd majors (19, 21, 23, 25…)
are "Current" releases with ~6 months of support then EOL. The claude-agent-acp package
requires Node.js ≥22 (`engines: { node: ">=22" }`), so anything below that is broken.

---

### Node.js version classifier (`classifyNodeVersion`)

**Status**: ✅ Done

**File changed:** `src/shared/version-checker.ts`

New export `classifyNodeVersion(version: string): NodeVersionStatus` with two warning cases:

- **Below v22**: "Below minimum required (v22). claude-agent-acp requires Node.js ≥22."
- **Odd major**: "v25 is a development release and is end-of-life. Switch to v24 LTS (v26 becomes LTS October 2026)."
- **Even ≥22**: no warning — clean.

Two update constants when v26 goes LTS (October 2026):
- `NODE_RECOMMENDED_LTS` → 26
- `NODE_NEXT_LTS` → `{ major: 28, when: "..." }`

---

### `renderEnvVersionRow` warning display

**Status**: ✅ Done

**File changed:** `src/components/settings/AgentClientSettingTab.ts`

The Node.js row now appends the `warning` suffix from `classifyNodeVersion` to the
description. npm row unchanged — npm versions track Node.js and have no equivalent
odd/even EOL concern.
