# PR-pending: TASK-295 (scoped `@prisma/config` effect override replacing the D-SECAUDIT-02 audit waiver), security review

**File name.** The PR does not exist yet. Once it does, the orchestrator renames this file on main, with `git mv` in a docs-only commit, to `docs/05-quality/security/PR-<NNNN>-TASK-295-security-review.md`, where `<NNNN>` is the PR number zero-padded to 4 digits. The content stays as it is. Main's `check-security-owned-paths.mjs` counts only `PR-<NNNN>-*.md` records for PR `<NNNN>`, so under the pending name this record satisfies nothing. Order (D-ORCH-136, D-ORCH-138): open the PR as a draft, rename the record on main, confirm that the PR's merge ref contains the renamed record, then mark the PR ready. **Read section 5 first:** main has moved, and the branch update that code review m1 requires will void the binding of this round.

| Field | Value |
|---|---|
| PR | Not opened yet. Branch `feat/TASK-295-prisma-bump-or-effect-override`, one commit on main `8281055c` |
| Head | 5edc54f5aba8dbacc4a7a5057b0909efc29ffe49 |
| Lane A evidence | None: the branch is not pushed. Main's classifier (`tools/ci/security-paths.mjs --base 8281055c --head 5edc54f5`) gives `security_paths=true` ("package-lock.json: production-closure change (node_modules/effect)"; effect is `devOptional`, which that classifier counts as production), so the hosted `security-integration` job runs on the PR |
| Lane B evidence | None yet. D-TASK295-03 requires full lane B (Prisma `migrate`, `generate`, shadow database, Testcontainers, migration linter on effect 3.22.4); the orchestrator has it queued on the evidence worktree `../Shipqube-TASK-295` |
| Owned paths changed | 4, as main's checker counts them (`--base 8281055c --head 5edc54f5`): root `package.json` (one `overrides` entry), `package-lock.json` (one tuple), `tools/ci/advisory-watchlist.json` (the D-SECAUDIT-02 waiver removed), `tools/ci/check-audit.test.ts` (the effect row removed from the register pin and from the due-date `it.each`; header comment) |
| Unowned paths changed | 1: `docs/sdlc/DECISIONS.md` (D-TASK295-01..03, a pure 14-line append) |
| Binding items checked | The TASK-295 card (`docs/04-plan/tasks/WAVE-01.md`) and D-SD-005 item 5; D-SECAUDIT-02 and its forcing plan (items 1-3); the PR #74 record (`PR-0074-audit-effect-security-review.md`: EFFECT-SEC-01..03); D-SECAUDIT-01 and PR67-SEC-02; CLAUDE.md section 5 (dependencies: allow-listed licence, no Critical/High, maintained); `.npmrc` (`min-release-age=7`, `save-exact=true`, `ignore-scripts=true`); ADR-0002 item 7 (root `overrides`); ADR-0023 am. F item 2; the lane A audit step in `ci.yml`; `tools/docker/scan-image-secrets.mjs` IMAGE_SCAN_ALLOW_LIST (D-TASK014-19); the code-review twin `docs/05-quality/reviews/PR-pending-TASK-295-code-review.md` (APPROVED_WITH_NITS, m1/m2, n1-n3, and its section 7 security flags) |
| Reviewer / date | security-analyst, 2026-11-20, round 1, pre-push. Host rule: no npm install, Jest or Docker, and nothing in the evidence worktree (not touched, not even read-only git; the branch was read with `git show`, `git diff --text` and `git archive` from the main checkout). Method: static review, registry and advisory-database reads, and single-process Node 24 probes on `git archive` extracts of `5edc54f5` and `8281055c`, with Prisma's real `@prisma/config` 7.10.1 from the main checkout's `node_modules` and the registry tarball of effect 3.22.4 |

## 1. Summary

- **The fix is real, not only a version string.** GHSA-7589-6fvf-x4pw (CVE-2026-121707, High, CWE-1333) covers effect `<= 3.22.0` and is patched in 3.22.1. The single effect tuple moves from 3.20.0 to 3.22.4. The npm bulk-advisory endpoint, OSV and the GitHub advisory database all return nothing for 3.22.4, and the advisory's own template, which takes 614 ms at n = 2,000 on 3.20.0 (cubic growth), takes 0 ms at n = 1,000,000 on 3.22.4.
- **The lockfile change is exactly one tuple.** A deep JSON diff of the base and head lockfiles finds exactly 3 differing leaves (`version`, `resolved`, `integrity` of `node_modules/effect`); a positive control (two planted changes) shows both. 1,636 entries on each side, one effect tuple on each side, `devOptional`, `license` and the `dependencies` block unchanged. The 3.22.4 manifest declares the same two dependencies as 3.20.0.
- **The tuple is authentic.** Registry integrity equals the lock integrity; the downloaded tarball's SHA-512 equals it too; both registry signatures verify against npm's public keys (a tampered-integrity control fails); the SLSA v1 provenance subject digest is the same SHA-512, built by `.github/workflows/release.yml` on `refs/heads/v3` of `github.com/Effect-TS/effect` on a GitHub-hosted runner (the statement was decoded and compared; the Sigstore bundle signature itself was not verified). Publisher: GitHub Actions trusted publishing, the same as 3.20.0. MIT. No lifecycle scripts.
- **Age and maintenance.** Published 2026-10-22T20:49:57Z, 28.6 days before the commit, so it clears `min-release-age=7` and the lane A cooldown. 3.22.5 (2026-11-19T21:22Z, a PubSub memory-retention fix, no advisory) is installable from 2026-11-26T21:22Z; moving to it is optional.
- **Scope is minimal and Prisma still works.** The nested override applies only to `effect` inside the `@prisma/config` subtree. npm 11.19.1's own Arborist shows the `@prisma/config` edge as spec `3.22.4` (raw `3.20.0`), valid; both `@hookform/resolvers` 5.9.2 optional peers (`^3.10.3`) are satisfied by the same tuple. No code of ours imports `effect` or `@hookform/resolvers`. Prisma's real `loadConfigFromFile` on the head `prisma.config.ts` gives the same result on 3.22.4 as on 3.20.0 (schema, migrations path, 23,565-character shadow-init script, 44 external tables, experimental flag), and three malformed configs produce byte-identical error classes and messages (SHA-256 compared). A resolution counter proves which effect copy each run loaded (1,891 resolutions into the 3.22.4 extract, 0 into the main checkout).
- **The gate passes on the new tree and still fails without the fix.** Head `check-audit` (and the tested-base copy, as lane A runs it) on `npm audit --json` of the head extract: PASS, exit 0. Control, head register on the base lockfile's audit: `audit/high: GHSA-7589-6fvf-x4pw effect`, FAIL, exit 1. An OSV batch query over all 1,307 distinct tuples of each lockfile differs only by `effect@3.20.0 GHSA-7589-6fvf-x4pw`.
- **No test was weakened beyond the waiver removal.** The diff of `check-audit.test.ts` deletes exactly two data rows (register pin, due-date table) and edits the header comment; every assertion body is unchanged. The register pin is still an exact `toEqual`, the due-date `it.each` keeps a real row (picomatch), and PR67-SEC-02 still asserts both "no waived package in the production closure" and "at least one waived tuple exists".
- **Findings: 0 Critical, 0 High, 0 Medium.** PR295-SEC-01 (LOW): the override has no removal trigger and is keyed to any `@prisma/config` version, so a later Prisma bump can silently force effect back to 3.22.4 (twin m2 (b)). PR295-SEC-02 (INFO): `npm ci` accepts a lockfile that contradicts the override, so the override itself is not the binding control (twin n2). PR295-SEC-03 (INFO): the image-scan allow-list comment still says "effect 3.20.0"; the six allow-listed paths are unchanged in 3.22.4.
- **Closures on merge.** EFFECT-SEC-01 is closed by the fix (not waived). D-SECAUDIT-02 is discharged: forcing-plan route 2 is taken, route 1 is correctly not taken, and the waiver, its pin and its row leave in the same PR. EFFECT-SEC-02 and EFFECT-SEC-03 still stand (section 4).

## 2. Evidence

| Check | How | Result |
|---|---|---|
| Diff scope | `git diff 8281055c 5edc54f5` (lockfile with `--text`) | 5 files. Root `package.json`: one `overrides` member, `"@prisma/config": { "effect": "3.22.4" }` (`package.json:108-110`). Lockfile: one hunk at `package-lock.json:15245-15248`. Watchlist: one waiver object removed. Test: two rows and the header comment. DECISIONS: append only |
| Lockfile delta, strict | generic deep JSON diff, base vs head, every differing leaf, with a positive control | 3 leaves, all under `/packages/node_modules/effect` (`version`, `resolved`, `integrity`). Control: the two planted changes appear. Entry count 1,636 / 1,636. Root `package.json` deep diff: 1 leaf (`/overrides/@prisma/config`) |
| Registry metadata | `npm view effect@3.22.4` and the packument; `node:crypto` | Version 3.22.4; `resolved` = registry tarball URL; integrity identical to the lock; tarball 4,220,905 bytes, SHA-512 identical; 2 of 2 signatures verify, tampered control fails; dependencies `fast-check ^3.23.1`, `@standard-schema/spec ^1.0.0` (same as 3.20.0, and the lock's nested `effect/node_modules/fast-check` 3.23.2 still satisfies them); `scripts` empty; licence MIT |
| Provenance | `-/npm/v1/attestations/effect@3.22.4`, DSSE payload decoded | publish v0.1 and SLSA provenance v1; subject `pkg:npm/effect@3.22.4` with the lock's SHA-512; workflow `Effect-TS/effect` `.github/workflows/release.yml` at `refs/heads/v3`; GitHub-hosted runner. Sigstore signature not verified here |
| Advisories, 3.22.4 | npm bulk endpoint; OSV `query`; GitHub `advisories?affects=effect` | npm: `{}` (positive control 3.20.0: GHSA-7589-6fvf-x4pw, high, `<=3.22.0`); OSV: none (control 3.20.0: the GHSA); GitHub: GHSA-7589-6fvf-x4pw (`<= 3.22.0`), GHSA-38f7-945m-qr2g (`< 3.20.0`), GHSA-chp3-j5qr-2vfr (4.0.0 betas only), GHSA-6hr9-4692-fch9 (`<= 1.0.4`, withdrawn): none covers 3.22.4 |
| Age | packument `time` | 3.22.4 at 2026-10-22T20:49:57Z; commit at 2026-11-20T11:45:05Z: 28.6 days. 3.22.5 at 2026-11-19T21:22:10Z |
| Route 1 (Prisma bump) correctly not taken | `npm view` of `prisma` and `@prisma/config` | `@prisma/config` latest 7.10.1 (2026-10-15), pins `effect: 3.20.0`; its dev line 8.1.0-dev.12 pins 3.20.0 too; no stable 7.11+ or 8.x. The `prisma` package's `latest` dist-tag points at a release candidate (8.0.0-rc.34), which no longer depends on `@prisma/config`; a major bump would need the ADR-0001 check the card names |
| Override semantics | npm 11.19.1's bundled Arborist, read-only (`loadVirtual`, `buildIdealTree`, npm's own `validate-lockfile`, no reify) on the head manifests (15 workspace `package.json` files plus root) | Head pair: 0 sync errors, one ideal effect node (`node_modules/effect@3.22.4`), `@prisma/config` edge spec `3.22.4` / raw `3.20.0`, valid. Scenarios for PR295-SEC-02 in section 3 |
| Config load on 3.22.4 | `loadConfigFromFile` from the main checkout's `@prisma/config` 7.10.1 on the head `prisma.config.ts` (extract with `tools/db`, `prisma/bootstrap`, `prisma/schema`), `effect`/`effect/*` resolved into the 3.22.4 tarball by a resolve hook; same probe without the hook as the 3.20.0 control | Identical summaries on both versions (`schema` `prisma/schema`, `migrations.path` `prisma/migrations`, `initShadowDb` 23,565 characters, 44 external tables, `experimental.externalTables` true, no datasource keys with the URL variables unset). Three malformed configs: same error tags (`UnknownError`, `ConfigFileSyntaxError`) and identical message hashes. `@prisma/config` uses only `Schema.Struct/String/optional/Array/Boolean/NonEmptyString/NullOr/Any/mutable/decodeUnknownEither`, `Either` and `pipe`; 0 `TemplateLiteral` |
| ReDoS behaviour | the advisory's template `TemplateLiteral(String, ":", String, ":", String, "X")` over runs of `:`, via `Schema.is`, one process per version | 3.20.0: 2 / 11 / 81 / 614 ms at n = 250 / 500 / 1,000 / 2,000. 3.22.4: 0 ms at n = 250 ... 2,000 and at 10,000 / 100,000 / 1,000,000. Functional controls (2 matching, 2 non-matching strings) agree on both |
| Audit gate, head | `npm audit --json` on a `git archive` extract of the head (root and workspace manifests, lock, `.npmrc`, `tools/ci`), then `check-audit.mjs --root <extract> --npm-audit <json> --now 2026-11-20T12:00:00Z` | npm audit: 0 high, 34 moderate (the base had 3 high: effect, `@prisma/config`, `prisma`). Head checker: PASS, exit 0, notes only for the watched glob and minimatch moderates. Tested-base checker (`8281055c`) over the head tree: PASS, exit 0 |
| Audit gate, controls | same, with the base lockfile's audit JSON | Head register: `audit/high: GHSA-7589-6fvf-x4pw effect (high, dev closure, fix available)`, FAIL, exit 1. Base register (waiver present): `audit/waived ... D-SECAUDIT-02, due 2026-12-18`, PASS |
| osv-scanner stand-in | OSV `querybatch` over every distinct `name@version` of each lockfile (1,307 / 1,307) | Only in base: `effect@3.20.0 GHSA-7589-6fvf-x4pw`. Only in head: none. Head ids: GHSA-3g3m-2fjr-6pw4 (glob, moderate) and GHSA-g3hv-75wg-m249 (minimatch, moderate), both watched. Not the real scanner image; lane A runs it |
| Changed test assertions | the head's `check-audit.mjs`, `check-dep-age.mjs` and `dep-gates-lib.mjs` loaded from the extract, the changed assertions replayed without Jest; the base extract as control | Head: register pin = picomatch only; watch ids unchanged; picomatch row open until 2027-02-12 then `audit/waiver-expired`; PR67-SEC-02 both halves pass; effect tuple `3.22.4`, not production; `cliNow` becomes 2026-11-18 and the register is valid at it. The removed effect row now yields `audit/high` (the waiver is really gone). Base control: the register pin fails, as it must |
| Lockfile and licence gates | head `check-lockfile.mjs` and `licence-check.mjs --root <extract>` (whole lockfile, no `--base`) | `check-lockfile: PASS`. `licence-check`: the same 4 `licence/missing` findings on the base and the head extract (they read installed `package.json` files that an extract does not have); effect is MIT in both lockfiles, so there is no licence delta. `check-dep-age` was not run (it needs `--base` in a git work tree and a registry fetch); the age is verified directly above |
| Image secret scan (tooling image ships effect) | Gitleaks v8.30.1 default-rule emulation over the package tree (precise mode: entropy, global and rule allow-lists, stop-words), 3.20.0 from the main checkout, 3.22.4 from the tarball; runtime-built positive controls | 3.20.0: exactly the six `generic-api-key` paths that IMAGE_SCAN_ALLOW_LIST lists (the D-TASK014-19 real-image result, so the emulation is calibrated). 3.22.4: the same six paths, nothing else. The allow-list stays exact; lane B's `images.stack` suite confirms with the real image |
| Owned-path classification | main's `check-security-owned-paths.mjs --base 8281055c --head 5edc54f5 --pr 9999 --json` and `security-paths.mjs` | 4 owned paths (above), status `missing` before this record; `security_paths=true` |

## 3. Findings

### PR295-SEC-01 · LOW · The override has no removal trigger and applies to every future `@prisma/config` version

- **CWE:** CWE-1395 (Dependency on Vulnerable Third-Party Component). **OWASP:** A06:2021 Vulnerable and Outdated Components.
- **Location:** `package.json:108-110`; premise in `package-lock.json:4784` (`node_modules/@prisma/config` declares `"effect": "3.20.0"`); removal rule only in D-TASK295-01 "Reversibility". Same issue as code review m2 (b).
- **Description.** npm `overrides` replace the declared spec unconditionally. The key `@prisma/config` has no version, so the override binds every future `@prisma/config`. When a Prisma bump arrives whose `@prisma/config` pins a newer effect (for example 3.23.x, possibly to pick up a fix), the regenerated lockfile still gets 3.22.4: npm reports no error, and no lane A check compares the override with the parent's new spec. Nothing prompts the bumper (a person or Dependabot, whose PR touches only the lockfile and `prisma/package.json`) to remove the override.
- **Exploitability and impact.** No exploit today: 3.22.4 is patched and the only consumer decodes our own `prisma.config.ts`. The risk is a future downgrade. If the newer pin carries a fix that has a published advisory, check-audit catches the forced old version (fail closed). If the fix ships without an advisory, or the newer Prisma needs newer effect APIs, the downgrade is silent, and effect runs in the tooling image next to `DATABASE_MIGRATOR_URL` and in lane A's `deps:rebuild`. Impact Low, likelihood Medium (Prisma bumps are routine): LOW.
- **Remediation (code level).** Pin the override's premise and its lockfile result in a unit test, so the next Prisma bump turns it red and forces a decision (remove the override, or re-decide with a new D-ID). Suggested file `tools/ci/root-overrides.test.ts` (owned path, so it needs a security round; it can ride on the branch update of section 5, whose merge-only round is owed anyway):

```ts
/**
 * Root `overrides` (ADR-0002 item 7, D-TASK295-01; PR295-SEC-01/02). Each override is pinned to the upstream spec it was
 * written to replace, and to the committed lockfile, so a Prisma bump or a lockfile regeneration cannot silently
 * keep, drop or bypass it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { findRepoRoot } from '../test-support/process.js';

const root = findRepoRoot();
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { overrides: Record<string, Record<string, string>> };
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')) as {
  packages: Record<string, { version?: string; dependencies?: Record<string, string> }>;
};

/** The upstream pin the effect override replaces. When @prisma/config changes it, remove the override or re-decide. */
const PRISMA_CONFIG_EFFECT_PIN = '3.20.0';

describe('root overrides', () => {
  it('[PR295-SEC-01] the @prisma/config effect override still replaces the exact pin it was written for', () => {
    expect(lock.packages['node_modules/@prisma/config']?.dependencies?.['effect']).toBe(PRISMA_CONFIG_EFFECT_PIN);
  });

  it('[PR295-SEC-02] the committed lockfile holds exactly one effect tuple, at the overridden version', () => {
    const tuples = Object.entries(lock.packages)
      .filter(([path]) => /(^|\/)node_modules\/effect$/.test(path))
      .map(([path, entry]) => `${path}@${entry.version ?? ''}`);
    expect(tuples).toEqual([`node_modules/effect@${pkg.overrides['@prisma/config']?.['effect'] ?? 'missing'}`]);
  });

  it('a new root override needs a decision and a premise test', () => {
    expect(Object.keys(pkg.overrides).sort()).toEqual(['@prisma/config', 'openapi-typescript']);
  });
});
```

- **Verification.** The assertion logic above was replayed without Jest on the head pair and five mutants. Head: pass, pass, pass. M1 (`@prisma/config` pins effect 3.23.0): the first test red. M2 (lockfile reverted to the base, override kept): the second red. M3 (a second, nested effect tuple): the second red. M4 (a new root override): the third red. M5 (override removed, lock kept): the second and third red. Lane B and the full `tools/ci` unit run apply as for any owned test.
- **Routing.** Owner devops-engineer via senior-developer. Due before the next PR that changes the `node_modules/@prisma/config` or `node_modules/prisma` tuple merges, and at the latest by G3. The ADR side (ADR-0002 item 7 still calls the `openapi-typescript` override and `@hookform/resolvers` 5.9.2 "the only version-selection deviations") is twin m2 (a): principal-architect adds the second override, D-TASK295-01 and the re-check rule. When the orchestrator closes STATUS condition EFFECT-WAIVER, the closure note names this residual and its owner.

### PR295-SEC-02 · INFO · `npm ci` accepts a lockfile that contradicts the override

- **CWE:** CWE-1395. **OWASP:** A06:2021. **Location:** `package.json:108-110` against `package-lock.json:15245-15248`. Same observation as code review n2 and D-TASK295-01 "Lockfile".
- **Description.** npm 11.19.1's `npm ci` check (`loadVirtual`, `buildIdealTree`, `validate-lockfile`, reproduced read-only with npm's bundled Arborist) passes all four pairings: head manifests with the head lock (edge valid, 3.22.4), head manifests with the base lock (edge invalid, ideal tree keeps 3.20.0, 0 sync errors), base manifests with the head lock (edge invalid, keeps 3.22.4, 0 errors), and base with base. So the override is advisory to `npm ci`: the committed lock tuple is what installs. The twin showed that `npm ls --package-lock-only --all` does exit 1 on the reverted pairing.
- **Exploitability and impact.** A lock merge resolved "take theirs" against a stale branch could restore 3.20.0 without an install error. Lane A's check-audit catches that today (the GHSA matches 3.20.0, control in section 2), so nothing vulnerable can merge silently while the advisory exists. A revert to an unpatched-but-unadvised version would not be caught, but no such version exists in the 3.22.x line above 3.22.1.
- **Remediation.** The second test of PR295-SEC-01 binds the lock to the override. Optional, for a later tooling task (twin n2): an `npm ls --package-lock-only --all` lockfile-consistency step in lane A.
- **Verification.** Mutant M2 above.

### PR295-SEC-03 · INFO · The image-scan allow-list comment names effect 3.20.0

- **CWE:** CWE-1116 (Inaccurate Comments). **OWASP:** A06:2021 (allow-list context for a third-party component). **Location:** `tools/docker/scan-image-secrets.mjs:271-273` (unchanged by this PR, unowned).
- **Description.** The six `packageFile('generic-api-key', '/app/node_modules/effect/...')` entries (D-TASK014-19) are justified as "module symbol keys of effect 3.20.0". Emulated over 3.22.4 they are still exactly the six matching files, so the allow-list stays exact and no new finding appears; only the version in the comment is stale.
- **Remediation.** Optional, devops-engineer: say "effect 3.20.0 to 3.22.4" (or drop the version) the next time the file changes, still without quoting the constants' values. The `.gitleaks.toml` entry for the old comment is bound to commit `dd7a2dd` and is unaffected by an edit of the current comment. Re-check the six paths at every effect bump; lane B's `images.stack` suite fails closed if they change.
- **Verification.** Lane B `tests/compose/images.stack.test.ts` on the tooling image after this PR.

## 4. Status of the earlier items

| Item | Status after this PR |
|---|---|
| EFFECT-SEC-01 (LOW; GHSA-7589-6fvf-x4pw reachable only through Prisma's config loader) | **Closed on merge, by the fix.** The tuple is outside the advisory range and the behaviour probe is linear |
| D-SECAUDIT-02 (28-day waiver, forcing plan) | **Discharged on merge.** Route 2 taken (exact 3.22.4, the newest 3.22.x at least 7 days old), route 1 correctly not taken, item 3 met (waiver, register pin and due-date row removed in the same commit). If the PR has not merged by 2026-12-18, main's waiver still expires and lane A fails, as designed |
| EFFECT-SEC-02 (INFO; the picomatch waiver matches a withdrawn advisory) | **Still stands.** GHSA-fc5q-39xc-vjpf is still withdrawn (2026-11-18T15:38:56Z); neither npm audit nor OSV reports picomatch on the head; the D-SECAUDIT-01 waiver is kept as a hedge until 2027-02-12 |
| EFFECT-SEC-03 (INFO; "dev closure" includes `devOptional`, so runtime stages must keep `--omit=optional`) | **Still stands.** effect stays `devOptional` (an optional peer of the production `@hookform/resolvers` in `apps/web` and `apps/admin`, and a dependency of the dev-only `@prisma/config`); no Dockerfile changed. Main's `security-paths.mjs` already treats such a tuple as production for gating |
| PR67-SEC-02 (closed by the lockfile-closure test) | **Still closed;** the test is unchanged and non-vacuous with picomatch as the only waiver |

## 5. State of main and the binding of this round

- **Main has moved.** Its tip when this round was written is `4e1163aa` (PR #78, TASK-038, and the twin's record `e2ce0b18` landed after the head's base `8281055c`). PR #78 changed root `package.json` (the `tokens:build` script) and appended D-SECPR038-01 to DECISIONS.md.
- **Consequence 1 (twin m1).** `git merge-tree` of main and the head conflicts in `docs/sdlc/DECISIONS.md` only, so GitHub builds no merge ref until the branch is updated. Resolve as a union with no deleted lines (the twin's proof steps).
- **Consequence 2 (this record).** After that branch update, the PR head is the merge commit and root `package.json` differs from `5edc54f5` (main's `tokens:build` line). `package.json` is an owned path that this PR also changes, so main's checker no longer accepts a record bound to `5edc54f5` (section 6 simulation). A **merge-only security round** on the merge commit is owed: it must show that root `package.json` is the union (main's script line plus this PR's `overrides` member), that the lockfile delta is still exactly the three effect leaves, and that the other owned paths are unchanged. Folding the PR295-SEC-01 test into the same update is welcome; that round then covers it.

## 6. Record simulation

Main's real `check-security-owned-paths.mjs` on a shared clone of the repository, with scenario commits built by plumbing (never checked out in the main checkout): main tip plus this record renamed to `PR-9999-TASK-295-security-review.md`, merged with the head, `--pr 9999`.

| Scenario | Checker arguments | Expected | Result |
|---|---|---|---|
| S1: merge-ref form, main `4e1163aa` plus the record, merged with `5edc54f5` (DECISIONS as a union) | `--base 4e1163aa --head 5edc54f5` | pass | exit 0, `pass` |
| S1b: same, event base = merge base | `--base 8281055c --head 5edc54f5` | pass | exit 0, `pass` |
| S2: the branch updated per twin m1 (head = merge of `5edc54f5` and main), record unchanged | `--head <merge>` | fail | exit 1: "names 5edc54f, but package.json changed after it" |
| C1: no record | as S1 | fail | exit 1, no record for PR #9999 |
| C2: the record with a FAIL verdict | as S1 | fail | exit 1, verdict FAIL refused |
| C3: the record's head row names the base commit | as S1 | fail | exit 1, names no commit of this PR |
| C4: the pending file name only | as S1 | fail | exit 1, no `PR-9999-*` record |

7 of 7 as expected. The candidate record has exactly one table row whose first cell starts with `Head` and one starting with `Verdict` (the last row). S2 is the reason for the merge-only round in section 5.

## 7. Answers to the twin's security flags

- **Override scope (m2 (b)) and gate tooling.** The scope is acceptable for this PR: it reaches one package (`effect`) inside one subtree (`@prisma/config`), and npm's tree shows no other dependant. No `tools/ci` gate imports effect. Effect code does run in two gate-adjacent places, lane A's `deps:rebuild` (`prisma generate` loads `prisma.config.ts`) and the tooling image's `migrate`/`seed`, which is why the tuple's integrity, signatures and provenance were verified above. The unversioned key is PR295-SEC-01.
- **osv-scanner on the head lock.** Not run (Docker). The OSV batch query over every tuple of the head lock reports no GHSA-7589-6fvf-x4pw and nothing outside the two watched moderates; lane A's real scanner is the binding evidence.

## 8. Still owed before merge

1. The branch update with the DECISIONS union (twin m1), then the merge-only security round of section 5.
2. Lane B on the head, or on the merge commit (D-TASK295-03; includes `images.stack` for PR295-SEC-03).
3. Lane A on the pushed head: `check-audit` with the real osv-scanner, `check-lockfile`, `check-dep-age`, `licence-check`, and the `security-integration` job (`security_paths=true`).
4. The rename of this record (and of the twin's) and the merge-ref check.

| Field | Value |
|---|---|
| Verdict | PASS_WITH_FOLLOW-UPS. No Critical, High or Medium finding for this change. LOW PR295-SEC-01 and INFO PR295-SEC-02/-03, routed. EFFECT-SEC-01 closes and D-SECAUDIT-02 is discharged when this PR merges; EFFECT-SEC-02/-03 stand. Binding: head `5edc54f5` only; the branch update of section 5 needs a merge-only round |

## Round 2 (merge-only): PR #79 head after the branch update

This round re-binds the record to the updated head. It follows section 5: the update merged `origin/main` into the branch, which brought in main's root `package.json` change, an owned path. It adds no new finding.

| Field | Value |
|---|---|
| Head | a1b0ba76c17639513f4e076c6a79d6809b932869 |
| Commits after `5edc54f5` | `253f7f4a`, the lane B evidence for `20261120T1205Z_5edc54f`, which adds only four files under `docs/05-quality/tests/runs/20261120T1205Z_5edc54f/`. Then `a1b0ba76`, `merge origin/main into task-295 (union of decisions log)`, with parents `253f7f4a` and main `4e1163aa` |
| Reviewer / date | security-analyst, 2026-11-20, merge-only round. Read from the main checkout with `git show`, `git diff` and `git merge-tree`. Single-process Node scripts ran on blobs only; I did not touch the evidence worktree |

### R2.1 Checks

| Check | How | Result |
|---|---|---|
| Merge resolution | `git merge-tree --write-tree 253f7f4a 4e1163aa`, then `git diff --name-status <that tree> a1b0ba76` | The only difference is `M docs/sdlc/DECISIONS.md`, the expected union. Every other path, including all four owned paths, is exactly the clean three-way merge. The resolution hand-edited nothing else |
| DECISIONS union | `git diff 4e1163aa a1b0ba76 -- docs/sdlc/DECISIONS.md` | 0 removed lines; the only additions are D-TASK295-01..03. All 14 lines the branch added on `8281055c` are present in the merged file |
| Root `package.json` | `git diff 4e1163aa a1b0ba76` and `git diff 5edc54f5 a1b0ba76`; deep JSON diff against main | Against main: only the `overrides` member `"@prisma/config": { "effect": "3.22.4" }`. Against the round-1 head: only main's `tokens:build` script line. So it is the union of both, and the deep diff against `origin/main` shows exactly 1 leaf, `/overrides/@prisma/config` |
| Lockfile | Blob identity; deep JSON diff of `a1b0ba76` against `origin/main` (`89d0b769`), with a positive control | The `package-lock.json` blob at `a1b0ba76` is `87332c13`, identical to `5edc54f5`. Main's blob `a4c0ba2e` is still the base blob, because PR #78 changed no lockfile. The deep diff shows exactly the 3 leaves `version`, `resolved` and `integrity` of `node_modules/effect` (3.20.0 to 3.22.4), 1,636 entries on each side and one effect tuple. The control shows its 2 planted changes. The lockfile SHA-256 equals the lane B summary's `lockfile_sha256` (`ca709fad…`) |
| Other owned paths | Blob identity | `tools/ci/advisory-watchlist.json` (`1905629c`) and `tools/ci/check-audit.test.ts` (`d2bda840`) are identical to `5edc54f5`. Main had not changed either one since `8281055c` |
| Owned-path set | main's `check-security-owned-paths.mjs --base 4e1163aa --head a1b0ba76` and `security-paths.mjs` | The same 4 owned paths as round 1. `security_paths=true`, so the hosted `security-integration` job runs |
| Carry-over | Round 1, section 2 | The lockfile, register and test blobs are byte-identical to round 1. The round-1 registry, advisory, ReDoS, config-load, audit-gate and OSV results therefore apply unchanged. The replay of the PR295-SEC-01 test logic on the merged pair passes all three assertions |
| Lane B evidence (read only) | `253f7f4a` `summary.json` / `summary.md` | Verdict PASS on `5edc54f5`, profile `pr`, clean build, `env_overrides` empty. The only suite run is `unit` (8,053 tests passed, 2 skipped). Path rule `images-and-deps` fired, but `compose-up`, `image-assertions` and `trivy` are still `planned` in the manifest, so the `images.stack` check named under PR295-SEC-03 did not run. The calibrated emulation in round 1 remains the evidence for SEC-03. The run reported no integration or Testcontainers suite, so the lane B part of D-TASK295-03 (Prisma `migrate`/shadow) is for the orchestrator and code review to judge. On the security side, the round-1 probe already ran Prisma's real `loadConfigFromFile` on effect 3.22.4 |

### R2.2 Findings and state of main

- **No new finding.** PR295-SEC-01 (LOW) and PR295-SEC-02/-03 (INFO) stay open with the round-1 routes. SEC-01 is not folded into this PR (coordinator decision): it is due before the next PR that changes the `prisma` or `@prisma/config` tuple, and by G3 at the latest.
- **The merge with main conflicts again.** Main's tip is now `89d0b769`, after `d7925b70` (D-ARCH-183..187) and the round-1 record commit, which appends D-SECPR295-01. `git merge-tree a1b0ba76 origin/main` reports a content conflict in `docs/sdlc/DECISIONS.md`. The existing `refs/pull/79/merge` (`66e895fa`) was built against `4e1163aa`. This round's own D-SECPR295-02 sits in the same region. Before merging, the branch needs one more DECISIONS-union update.
- **That next update does not void this round.** It brings in only `docs/03-architecture/**`, `docs/sdlc/DECISIONS.md` and this record, none of which is an owned path (simulation R2.3, scenario S2). A new security round is needed only if an owned path changes after `a1b0ba76`.

### R2.3 Record simulation

I ran main's real `check-security-owned-paths.mjs` in a shared clone, on scenario commits built with git plumbing. Base: main `89d0b769` plus this record with round 2 appended, named `PR-9999-…`, plus D-SECPR295-02. Flags: `--pr 9999`. Every DECISIONS conflict was resolved as a union.

| Scenario | Expected | Result |
|---|---|---|
| S1: the merge-ref form, (main + record with round 2) merged with `a1b0ba76`, `--base 4e1163aa --head a1b0ba76` | pass | exit 0 |
| S2: the next branch update (the branch merged with that main, DECISIONS as a union), `--base` = that main, `--head` = the update | pass | exit 0 |
| C1: round-1-only record, `--head a1b0ba76` | fail | exit 1: "names 5edc54f, but package.json changed after it" |
| C2: round 2 with a FAIL verdict | fail | exit 1, verdict FAIL refused |
| C3: a commit on `a1b0ba76` that edits root `package.json` | fail | exit 1: "names a1b0ba7, but package.json changed after it" |
| C4: no record | fail | exit 1 |

6 of 6 as expected. The record now has two Head rows, one per round, and its last Verdict row is this round's.

| Field | Value |
|---|---|
| Verdict | PASS_WITH_FOLLOW-UPS. Merge-only round on `a1b0ba76`: root `package.json` is the union of main's `tokens:build` script and the override; the lockfile change against main is still exactly the 3 effect leaves; the merge resolution changed nothing else that is owned. No new finding. PR295-SEC-01 (LOW) and SEC-02/-03 (INFO) stay open as routed in round 1 |
