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

### Follow-up recommendation (not done here)

The repo carries **two** release workflows, `.github/workflows/release.yaml`
and `.github/workflows/release.yml`, which is worth reconciling. Whichever
survives should validate the dispatched version against the current
`package.json` — rejecting any input that is not a semver increment of the
existing version would have caught `0.70.0` before it shipped.
