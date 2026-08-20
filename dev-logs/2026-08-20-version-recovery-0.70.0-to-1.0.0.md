# Dev Log — 2026-08-20 — Version recovery: bogus v0.70.0 → v1.0.0

## Version: 1.0.0 (major — recovery release)

---

### Incident

On 2026-08-19 the release workflow was dispatched with **`0.70.0`** as the
plugin version. That number is the **`claude-agent-acp` tested ceiling**
from PR #20 ("Bump claude-agent-acp tested ceiling 0.65.0 -> 0.70.0"),
not a plugin version. The plugin was on 0.9.7 and should have gone to
0.9.8.

The bot commit `7e98788 "Release v0.70.0"` wrote the wrong version into
`manifest.json`, `package.json`, and `versions.json`, and published a
GitHub release `v0.70.0`, which BRAT then served to users. Installs
showed the update notice **"AI Tools updated v0.9.6 → v0.70.0"**.

To be clear about what was *not* wrong: the ACP tested ceiling of 0.70.0
in `src/shared/version-checker.ts` is correct and stays as-is. Only the
plugin's own version number was wrong.

---

### Why the fix is 1.0.0 and not 0.9.8

Reverting to 0.9.8 would have **stranded every user who already
auto-updated**. Their installed manifest reads `0.70.0`, and both BRAT and
the plugin's own update checker compare semver — `0.9.8 < 0.70.0`, so
those users would never be offered another update and would need a manual
reinstall.

`1.0.0` is greater than both `0.70.0` and `0.9.7`, so it supersedes the
bogus release, pulls already-updated users back onto the correct track
automatically, and restores a sane forward sequence (1.0.1, 1.1.0, …).
Paul's call, 2026-08-20.

---

### Changes

**Status**: ✅ Done

- `manifest.json`: `0.70.0` → `1.0.0`
- `package.json`: `0.70.0` → `1.0.0`
- `versions.json`: bogus `"0.70.0"` entry removed, `"1.0.0": "0.15.0"` added
- GitHub release `v0.70.0` and its tag deleted from upstream so it stops
  being served to users who have not yet updated
- `src/shared/version-checker.ts`: **unchanged** — ACP ceiling stays 0.70.0

### Prevention — release workflow consolidation

**Status**: ✅ Done

The repo carried two release workflows. They are now one.

**Deleted `.github/workflows/release.yml`** ("Release + Patch Version
Increment") — the workflow that caused this incident. It accepted an
arbitrary `version` dispatch input with no validation, wrote it into
`package.json`/`manifest.json`, committed as `github-actions[bot]`, and
then ran `git push origin master --force` plus force-pushed tags. Beyond
the version bug, a CI job force-pushing `master` is a standing hazard.

**Kept `.github/workflows/release.yaml`** ("Release"). It never invents a
version: it releases what is already committed, triggered by pushing a
`v*` tag. Version bumps now happen in a reviewed PR (`npm version` runs
`version-bump.mjs`, which updates `manifest.json` and `versions.json`),
so a wrong number has to survive code review before it can ship.

Its `validate` job was hardened with four checks:

1. `manifest.json` and `package.json` versions must agree
2. the tag must match the committed manifest version (pre-existing check)
3. `versions.json` must contain an entry for the release
4. the version must be a **legal successor** of the previous release tag —
   only patch+1, minor+1, or major+1 are accepted

Check 4 is the one that catches this incident. A simple "must be greater"
rule would not have: `0.70.0` *is* semver-greater than `0.9.7`. Requiring
a legal successor means the only versions accepted after 0.9.7 are 0.9.8,
0.10.0, and 1.0.0 — so `0.70.0` is rejected, while the 1.0.0 recovery
release passes. Verified against both cases plus 0.10.0 (allow) and
2.0.0 (reject, version skipping).

### Release procedure from here

1. Bump in a PR: `npm version patch|minor|major` (updates package.json,
   manifest.json, versions.json), commit, open PR, merge
2. Tag the merged commit `vX.Y.Z` and push the tag
3. `release.yaml` validates, lints, builds, and publishes the release
