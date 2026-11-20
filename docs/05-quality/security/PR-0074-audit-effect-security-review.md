# PR-pending (audit effect) / D-SECAUDIT-02: change-scoped security review (waiver for the dev-only effect High GHSA-7589-6fvf-x4pw)

> **File name:** the coordinator renames this file to `PR-<number, 4 digits>-audit-effect-security-review.md` once the PR exists (D-ORCH-140 routing). The record check accepts only that name.

| Field | Value |
|---|---|
| PR | Pending. Branch `chore/audit-waive-effect` is committed locally in the worktree `../Shipqube-audit-effect`. It is **not pushed**: the coordinator queues lane B first, then pushes and opens the PR (draft, rename, confirm merge ref, ready) |
| Branch | `chore/audit-waive-effect`: 1 commit (`67c4c04`) on the base `cb2ed535` (origin/main when the branch was cut). 2 files, +44 / -19 |
| Head | 67c4c04d260432569a9effc9ab17e912dd296b66 |
| Main when written | `cb2ed535`. This record and D-SECAUDIT-02 follow it on main. Neither touches one of the PR's 2 owned paths |
| Security-owned paths changed (CODEOWNERS `/tools/ci/`) | `tools/ci/advisory-watchlist.json`, `tools/ci/check-audit.test.ts` (2) |
| Dependencies / workflows | `package.json`, `package-lock.json`, `.npmrc` and `.github/**` are untouched. `check-audit.mjs`, `dep-gates-lib.mjs` and `check-dep-age.mjs` are unchanged; lane A runs the base-ref copies and reads the register from the merge-ref work tree |
| Binding items checked | CLAUDE.md §5 (dependencies; the "safe alternative" clause), §2 fixed stack (Prisma 7.10, ADR-0001), US-048 AT-US-048-06/07, code review m7 / PR10-SEC-12 (90-day cap, DECISIONS ID), D-SECAUDIT-01 (single-segment decision ID; a watch entry cannot clear a High), PR67-SEC-02 (due before the next waiver: closed here), PR2-SEC-06 (no overrides inside gate tooling), D-ORCH-140 (routing) |
| Code-review twin | None yet. **A code reviewer is needed:** I authored the change, and the test code changed |
| Reviewer / date | security-analyst, 2026-11-20. **This review is of my own change**, so independence rests on the code-review twin. Commands in the new worktree `../Shipqube-audit-effect`: `git worktree add` from origin/main, edits, `prettier --write` on the 2 files, ESLint and a scoped `tsc --noEmit` on the test file, and `jest --selectProjects unit --runInBand tools/ci/check-audit.test.ts` with 3 mutants. These ran through a temporary `node_modules` junction to the main checkout, removed afterwards (main's `node_modules` stays at 743 entries). Then one local `git commit`; I did not push. The main checkout ran `npm audit --json` once (a read-only registry query), plus `npm ls`/`npm view` and read-only `curl`/`gh`. No Docker, no heavy suite, no PostgreSQL |

## 1. Summary

**The waiver is the correct form, it is exact, and it weakens no gate.** It runs for 28 days, and its expiry forces the real fix.

- **Why the gate fails.** GHSA-7589-6fvf-x4pw (CVE-2026-121707) was published and GitHub-reviewed on 2026-11-19 at 20:51Z. It covers effect `<= 3.22.0`, is rated High (CVSS 4.0 8.7, CWE-1333) and describes a ReDoS in the regex that `Schema.TemplateLiteral` compiles. From the next day, lane A's `check-audit` fails every PR; the first failure was PR #73, run 44679323524.
- **The coordinator's premise needs one correction.** The patched releases are not too new:

  | Version | Published |
  |---|---|
  | 3.22.1 | 2026-07-30 |
  | 3.22.2 | 2026-09-09 |
  | 3.22.3 | 2026-10-16 |
  | 3.22.4 | 2026-10-22 |
  | 3.22.5 | 2026-11-19T21:22Z (the only one younger than `min-release-age=7`; installable from 2026-11-26T21:22Z) |

  The blocker is **Prisma's exact pin**:
  - `@prisma/config` 7.10.1, the latest stable, declares `"effect": "3.20.0"`. So do `7.9.1-dev.1` and the `dev` tag `8.1.0-dev.12` (2026-11-13). No `@prisma/config` release after 7.10.1 exists on the stable line.
  - `@hookform/resolvers` 5.9.2 (web and admin) has `effect` only as an **optional** peer `^3.10.3`, deduped onto the same single tuple `node_modules/effect` 3.20.0.
  - An in-range bump therefore cannot remove 3.20.0, so option (a) does not apply. npm's "fix available" is `prisma@6.12.0` (`isSemVerMajor`), a downgrade.
- **Closure.**
  - The lockfile flags `node_modules/effect` as `devOptional: true` (MIT), which `check-audit` counts as dev closure.
  - It reaches production package graphs only through optional peers (`@hookform/resolvers`, and `@prisma/client` → `prisma`).
  - The api and worker runtime stages install with `--omit=dev --omit=optional`, so effect is not shipped. Web and admin ship nginx-served static bundles, and nothing of ours imports `@hookform/resolvers` or `effect` (a tree-wide `git grep` over apps, packages, tools, prisma and tests finds only a `.dockerignore` test fixture path). So no bundle contains it.
  - The Prisma CLI images (compose `bootstrap`/`migrate`/`seed`, `prisma/Dockerfile`) and lane A's `deps:rebuild` → `prisma generate` do load it, through `@prisma/config`.
- **Reachability.**
  - The advisory needs a `Schema.TemplateLiteral` with two or more `Schema.String` spans, decoding attacker input.
  - `@prisma/config` 7.10.1 uses only `Struct`, `String`, `optional`, `mutable`, `Array`, `Boolean`, `NullOr`, `NonEmptyString` and `Any`, with `decodeUnknownEither` (`dist/index.js` lines 435 and 462). `TemplateLiteral` occurs 0 times.
  - Its only input is our own `prisma.config.ts` (the operator's config and environment).
  - The probe in §2.2 confirms this: Prisma's real `loadConfigFromFile` over a config whose every string is 50,000 `:` characters stays at about 114 ms, while the advisory's own template blows up cubically.
- **In-context severity: LOW** (EFFECT-SEC-01). Impact would be Low (a build or migrate tool stalls), and Likelihood Very Low (no TemplateLiteral on the path, and the input is our own config).
- **The waiver:** granted 2026-11-20, expires **2026-12-18** (28 days), decision D-SECAUDIT-02. A watch entry cannot clear a High (control C4 exits 1), and a waiver longer than 90 days is refused (control C5 exits 2).
  - The literal rule in the routing ("expire when the first patched version becomes installable") cannot be applied, because that date (2026-08-06) is long past.
  - I chose 28 days instead. That is long enough for one Prisma patch release, and short enough that the scoped-override fallback (§4) is the forced action if Prisma does not move.
- **PR67-SEC-02 is closed here** (it was due "before the next waiver is added"). A new unit test fails the PR that moves any waived package into a production-closure tuple of the committed lockfile.

| | Question | Ruling |
|---|---|---|
| (a) | Is there an in-range bump to a patched version at least 7 days old? | **No.** Patched versions old enough exist (3.22.1 to 3.22.4), but `@prisma/config` 7.10.1 pins `effect` 3.20.0 exactly and no newer stable `@prisma/config` exists. A bump of the `@hookform/resolvers` edge alone would leave 3.20.0 in the tree |
| (b) | A waiver, and until when? | **Yes, until 2026-12-18.** The expiry forces the fix: a Prisma bump if a stable `@prisma/config` allows effect >= 3.22.1 and is at least 7 days old, else an `overrides` entry scoped to `@prisma/config`. Renewing it needs a new decision explaining why neither was possible |
| (c) | Who pulls effect? Any runtime closure? | `@prisma/config` (exact 3.20.0, via `prisma`), plus `@hookform/resolvers` (optional peer). Runtime: **no**. The lockfile says devOptional, the runtime stages omit dev and optional, and no source imports it |
| (d) | Does untrusted input reach `Schema.TemplateLiteral`? | **No.** No code of ours uses effect, and `@prisma/config` never builds a TemplateLiteral (§2.2) |

## 2. Evidence

### 2.1 Advisory, registry, lockfile

| Item | Value |
|---|---|
| Advisory | GHSA-7589-6fvf-x4pw / CVE-2026-121707, published and reviewed 2026-11-19T20:51Z, not withdrawn. Range `<= 3.22.0`, first patched 3.22.1 (upstream fix PR 6761: an all-`String` template is matched by a linear scan) |
| Registry | effect `prev` = 3.22.5 (the 3.x line; `latest` is 4.1.4). Release dates as in §1 |
| Prisma | `@prisma/config` latest 7.10.1 (2026-10-15), `dependencies.effect = 3.20.0`. The `patch-dev` 7.9.1-dev.1 and `dev` 8.1.0-dev.12 tags have the same pin |
| Lockfile | One tuple, `node_modules/effect` 3.20.0, `devOptional: true`, MIT. Dependents: `node_modules/@prisma/config` (`effect: 3.20.0`, devOptional); `apps/{web,admin}/node_modules/@hookform/resolvers` (`peerDependencies.effect ^3.10.3`, `peerDependenciesMeta.effect.optional`) |
| npm audit (base lockfile, 2026-11-20) | 37 entries: 3 high, 34 moderate. The high entries are effects of GHSA-7589-6fvf-x4pw. The only other advisories are the watched glob and minimatch moderates. npm `fixAvailable` for effect = `prisma@6.12.0`, semver-major |
| Maintenance exceptions | effect is not listed, so a waiver can apply |

### 2.2 ReDoS probe

Each case runs in its own child process with a 20 s watchdog, using effect 3.20.0 from the main checkout.

| Case | n=250 | n=500 | n=1,000 | n=2,000 | n=50,000 |
|---|---|---|---|---|---|
| Positive control: `Schema.is(TemplateLiteral(String, ":", String, ":", String, "X"))` on `:`×n | 5 ms | 35 ms | 235 ms | 1,703 ms | not run |
| Positive control, `decodeUnknownEither` | 4 ms | 26 ms | 188 ms | 1,476 ms | not run |
| Single-span `TemplateLiteral("prefix-", String)` | 0 ms | 0 ms | 0 ms | 0 ms | 0 ms |
| Prisma's real `loadConfigFromFile` with `schema`, `migrations.path`, `migrations.seed`, `datasource.url` and `typedSql.path` all set to `:`×n | 261 ms | 104 ms | 128 ms | 154 ms | 114 ms (all `ok`) |

The controls grow about 7 to 8 times per doubling, which is the advisory's cubic growth. Prisma's loader time is module loading, and it stays flat at 50,000 characters.

### 2.3 `check-audit` matrix

These runs use main's script, today's `npm audit --json`, and a lockfile identical to the base. osv-scanner was not run (no Docker); lane A merges both scanners under one `GHSA|package` key, as PR #67's run showed.

| Run | Register | `--now` | Exit | Result |
|---|---|---|---|---|
| R1 | head | 2026-11-20 | **0** | `audit/waived: GHSA-7589-6fvf-x4pw effect (high, dev closure, fix available): tracked by D-SECAUDIT-02, due 2026-12-18 (28 days)` |
| C1 | base (control) | 2026-11-20 | 1 | `audit/high: GHSA-7589-6fvf-x4pw effect …` (reproduces lane A) |
| C2 | head | 2026-12-18 | 1 | `audit/waiver-expired: … waiver D-SECAUDIT-02 expired on 2026-12-18` |
| C3 | head | 2026-11-19 | 2 | `waivers[1].granted (2026-11-20) is in the future` |
| C4 | base + an effect **watch** entry only | 2026-11-20 | 1 | `audit/high` plus `note audit/watched` |
| C5 | head with `expires` 2027-02-19 (91 days) | 2026-11-20 | 2 | `a waiver may span at most 90 days` |

### 2.4 Tests

`tools/ci/check-audit.test.ts` at the head has three changes:

- Line 79 pins the effect waiver.
- Line 83: the PR #67 due-date test becomes an `it.each` table, with one row per committed waiver (D-SECAUDIT-01 and -02).
- Line 108 adds the new `[PR67-SEC-02]` test. It asserts that no committed waiver's package has a production-closure tuple in the committed `package-lock.json` (`tuplesOf(readLockfile(repoRoot))`), and that at least one waived package is present, so the check is not vacuous.

The existing `cliNow` (line 213) moves to the newest grant date (2026-11-20) by itself.

| Check | Result |
|---|---|
| `jest --selectProjects unit --runInBand tools/ci/check-audit.test.ts` | 30/30 pass |
| M1: effect waiver removed from the register | 2 tests red (pin, D-SECAUDIT-02 row) |
| M2: `devOptional` deleted from `node_modules/effect` in the lockfile (production closure) | 1 test red (PR67-SEC-02) |
| M3: every waiver's package renamed to one absent from the lockfile | the PR67-SEC-02 test red (non-vacuity guard) |
| ESLint (`--max-warnings 0`), Prettier `--check` | clean |
| Scoped `tsc --noEmit` on the test file | clean; a control mutant (`t.productionX`) gives 1 error |

The worktree and `package-lock.json` were restored after the mutants (`git status` shows only the committed change). Lane A's lint, type-check and unit steps and lane B's `unit` suite are still owed; this does not replace them.

## 3. Findings

| ID | Severity | CWE / OWASP 2021 | Location | Status |
|---|---|---|---|---|
| EFFECT-SEC-01 | LOW (in context; advisory High) | CWE-1333 / A06 Vulnerable and Outdated Components | lockfile tuple `node_modules/effect` 3.20.0 (devOptional), via `@prisma/config` 7.10.1 | Waived by D-SECAUDIT-02 until 2026-12-18 |
| EFFECT-SEC-02 | INFO | n/a / A06 | `tools/ci/advisory-watchlist.json`, the D-SECAUDIT-01 waiver | Open, no action needed |
| EFFECT-SEC-03 | INFO | CWE-1104 / A06 | `tools/ci/dep-gates-lib.mjs` `inProductionClosure` (devOptional counts as dev) | Open, documentation |
| PR67-SEC-02 | LOW | CWE-1104 / A06 | `tools/ci/check-audit.test.ts` line 108 | **Closed** by this PR (option ii) |

**EFFECT-SEC-01 (LOW): GHSA-7589-6fvf-x4pw, effect ReDoS, reachable only through Prisma's config loader.**

- **Exploitability.**
  - The vulnerable regex is built only for `TemplateLiteral` AST nodes, which neither our code nor `@prisma/config` creates.
  - The loader's input is our committed `prisma.config.ts` and the operator's environment.
  - `@hookform/resolvers`' effect resolver is unused, and in any case it would run in the user's own browser tab.
- **Rating.** Impact Low × Likelihood Low gives LOW (threat-model §1).
- **Remediation, due by 2026-12-18** (owner senior-developer; the dependency task, PR via the normal flow). Steps (1) to (3) are in order of preference:
  1. If a stable Prisma whose `@prisma/config` allows effect >= 3.22.1 is at least 7 days old, bump `prisma`, `@prisma/client` and `@prisma/adapter-pg` together within 7.10.x/7.x. A minor beyond 7.10 needs principal-architect's ADR-0001 check.
  2. Otherwise, add `"overrides": { "@prisma/config": { "effect": "3.22.x" } }` in the root `package.json`, pinned to the newest 3.22.x that is at least 7 days old (3.22.4 today; 3.22.5 from 2026-11-26T21:22Z). Run `npm install --package-lock-only` and then full lane B, because the lockfile changes; lane A's `deps:rebuild` → `prisma generate` exercises the config loader. This is a same-major transitive override scoped to the Prisma CLI's config package, not gate tooling, so PR2-SEC-06's rule does not bar it.
  3. Remove this waiver, its test row and its pin in the same PR.
- **Verification.** The `[D-SECAUDIT-02]` test row, plus lane A turning red again on 2026-12-18 if nothing lands.

**EFFECT-SEC-02 (INFO): the D-SECAUDIT-01 picomatch waiver now covers a withdrawn advisory.**

- **Problem.** GitHub withdrew GHSA-fc5q-39xc-vjpf at 2026-11-18T15:38:56Z, after PR #67 merged at 13:06Z. Today's `npm audit` no longer reports it.
- **Ruling.** The waiver is harmless: it matches nothing. If the advisory is reinstated, the waiver still covers it until 2027-02-12. Remove it at the next register change after its expiry, or let it lapse; no code change now.
- **New test.** The PR67-SEC-02 test checks only that *some* waived package is present (non-vacuity), so a stale waiver does not break unrelated PRs.

**EFFECT-SEC-03 (INFO): "dev closure" includes `devOptional`.**

- **Problem.** `inProductionClosure` returns false for `devOptional`. Such a package *is* installed by an `npm ci --omit=dev` that keeps optional dependencies. Effect is such a package, through optional peers of production dependencies.
- **Why it is safe today.** Our runtime stages use `--omit=dev --omit=optional` (`apps/api/Dockerfile` line 70, `apps/worker/Dockerfile` line 67). The web and admin build stages install everything, but ship only static bundles.
- **What to watch.** Any new runtime stage must keep `--omit=optional`, or the "dev closure" label of devOptional advisories stops being true. That is worth a line in the image-hardening checks (TASK-014 owner) when next touched.

## 4. Process

- **Lane B evidence is required.** `selectSuites` on the worktree's manifest (profile `pr`) gives `{"required":["unit"]}` for the 2 paths. The worktree `../Shipqube-audit-effect` is clean at `67c4c04`, with no `node_modules`, and ready for the queue. The branch is not pushed.
- **Code review is needed** (test code changed, and I authored it).
- **This record is on main under a pending name.** After the rename to `PR-<n>-audit-effect-security-review.md`, ci-gate reads it from the merge ref at the next `pull_request` event. The Head row names `67c4c04`, which stays in the PR range when the evidence commit is added on top. The evidence directory is not an owned path.
- **After merge,** open PRs pass the audit step at their next `pull_request` event. Re-runs of old runs reuse old merge refs and still fail.

## 5. Record simulation

This runs main's `check-security-owned-paths.mjs` in a sparse `clone --shared` (`.github/`, `docs/05-quality/security/`, `tools/ci/`).

- The file is renamed to a stand-in number, `PR-0099-…`, with `--pr 99`, because the real number does not exist yet.
- The scenario merges are built with plumbing on main's tip `cb2ed535` and the local head `67c4c04`; no ref moved.
- Every run uses `--base cb2ed535 --head 67c4c04…`.

| Scenario | Expected | Exit / status |
|---|---|---|
| S1 record renamed to `PR-0099-…` on main, merged with the head | pass | 0 / pass |
| S2 as S1, plus an evidence-only commit on top of the head (`docs/05-quality/tests/runs/…`), with `--head` set to that commit | pass | 0 / pass |
| C1 record left under the pending name | missing | 1 / missing |
| C2 no record | missing | 1 / missing |
| C3 Verdict cell set to `FAIL` | rejected | 1 / missing |
| C4 Head row naming a main commit (`cb2ed535`) | rejected | 1 / missing |

C1 shows that **the rename is required**. The record has exactly one row whose first cell starts with `Head`, and one `Verdict` row, which is the last.

## 6. Verdict

| Field | Value |
|---|---|
| Verdict | **PASS_WITH_FOLLOW-UPS.** 0 Critical/High open for this change. EFFECT-SEC-01 (LOW) is waived until 2026-12-18 under D-SECAUDIT-02, and its remediation is due by then. PR67-SEC-02 is closed. EFFECT-SEC-02 and EFFECT-SEC-03 are INFO. Lane B `unit` evidence, a code-review round and the file rename to the PR number are owed before merge |
