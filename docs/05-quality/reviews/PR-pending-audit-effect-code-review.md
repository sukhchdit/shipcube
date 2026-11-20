# Code review: time-boxed waiver for GHSA-7589-6fvf-x4pw (effect), pre-PR round 1

| Field | Value |
|---|---|
| Branch / head | `chore/audit-waive-effect` at `67c4c04d` (base `cb2ed535`), one commit; no PR number yet |
| Files | `tools/ci/advisory-watchlist.json` (+8), `tools/ci/check-audit.test.ts` (+36/-19) |
| Bindings | D-SECAUDIT-02 (forcing plan), D-SECAUDIT-01 / PR #67 waiver pattern, PR67-SEC-02, security record `docs/05-quality/security/PR-pending-audit-effect-security-review.md` (PASS_WITH_FOLLOW-UPS), US-048 AT-US-048-06/07, CLAUDE.md §5 dependencies |
| Reviewer | code-reviewer, 2026-11-20 |

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: The waiver follows the D-SECAUDIT-01 pattern exactly: single-segment decision ID, granted not in the future, a
         28-day horizon (cap 90), and check-audit fails every PR again from 2026-12-18T00:00Z. The PR #67 due-date test
         is now a table, and the new PR67-SEC-02 test is meaningful: it is killed by a lockfile mutation and is not
         vacuous. No BLOCKER, MAJOR or MINOR. Three NITs plus one pre-existing observation.
```

## 1. What I verified myself

| Check | How | Result |
|---|---|---|
| Test file | `git archive 67c4c04d` copy, `node_modules` junctioned to `../Shipqube-audit-effect`, `git init` for `findRepoRoot`; `jest --selectProjects unit --testPathPatterns tools/ci/check-audit --maxWorkers=2` | 30/30 pass |
| Mutant M1: `devOptional` deleted from `node_modules/effect` in the copy's lockfile (so effect joins the production closure) | Same run | 1 failed (the PR67-SEC-02 test): killed |
| Mutant M2: effect flagged `optional: true` instead of `devOptional` | Same run | 30 pass. This is consistent with the gate's closure definition, which is what `npm ci --omit=dev --omit=optional` installs, and every runtime stage uses that (see EFFECT-SEC-03) |
| Expiry semantics | `isExpired`: `now >= expires` at 00:00Z | The waiver covers up to 2026-12-17T23:59:59Z, and the table row's `${due}T00:00:00Z` case pins exactly that boundary |
| Waiver matching | `same()`: GHSA id (case-insensitive) and package name, in any closure | Matches the D-SECAUDIT-01 entry. The closure gap is what the new test pins against the lockfile |
| Lane A reach of the pin | `ci.yml` runs the full `npm run test:unit` | A PR that moves effect into the production closure fails in lane A, even if it changes only the lockfile |
| Lockfile facts | Parsed `packages` at the head | `node_modules/effect` 3.20.0, `@prisma/config` 7.10.1 and `prisma` 7.10.1 are all `devOptional`; `@hookform/resolvers` 5.9.2 in `apps/{web,admin}` |
| Images | `apps/{api,worker}/Dockerfile` runtime stages; `prisma/Dockerfile` | The runtime stages use `npm ci --omit=dev --omit=optional`. The tooling image (`bootstrap` / `migrate` / `seed`) installs the prisma workspace `--include=dev`, so it ships effect through `@prisma/config` (see n1) |

Not run: anything else (host rule). The copy and junction were removed; the worktree is untouched (clean `git status`).

## 2. Test logic

- **Committed-register pin.** The exact `[id, package, decision, granted, expires]` list now has the second row. Any edit to the dates or the decision fails here, as for picomatch.
- **`it.each` due-date table.** Each row is checked in two ways. (a) At `granted T12:00Z`: no finding, plus the note `tracked by <decision>, due <expires>`. (b) At `expires T00:00Z`: exactly `['audit/waiver-expired']`. The advisory is a synthetic dev-closure High carrying the real GHSA id and package, which is what the waiver keys on. The PR #67 assertions are preserved row for row, and the title shortening to `'ReDoS'` loses nothing.
- **PR67-SEC-02 pin.** It reads the committed lockfile through the same `tuplesOf` / `inProductionClosure` model the gates use. It asserts that no waived package has a production tuple, and that at least one tuple of a waived package exists (the non-vacuity guard). A mutation kills it (M1). This closes PR67-SEC-02 as a lockfile invariant, and that is the right place: check-audit's own "waiver applies in any closure" rule stays unchanged and shared.

## 3. Expiry and forcing plan

- **Horizon.** 2026-11-20 → 2026-12-18 is 28 days, within MAX_WAIVER_DAYS = 90. A future `granted` or a 91-day span is refused by `validateWaiver` (security record C4/C5).
- **Forcing.** From 2026-12-18 every PR's check-audit run fails with `audit/waiver-expired` while the advisory is still reported. D-SECAUDIT-02 names the owner (senior-developer) and the two routes: a Prisma bump once a stable `@prisma/config` allows `effect >= 3.22.1`, or a scoped `overrides` entry to a 3.22.x that is at least 7 days old. Renewal needs a new decision. This is the PR #67 pattern.
- **Exploitability.** The rationale holds. `@prisma/config` decodes only our own `prisma.config.ts` with Struct/String schemas. No TemplateLiteral with two String spans is ever built over attacker input, and no source of ours imports effect or `@hookform/resolvers`.

## 4. Findings

| ID | Severity | file:line | Issue | Fix |
|---|---|---|---|---|
| n1 | NIT | `tools/ci/advisory-watchlist.json` (the new `reason`) | "no runtime image installs it" overstates the case. The Prisma tooling image (`prisma/Dockerfile`, Compose `bootstrap` / `migrate` / `seed`, and the deployed migrate task) installs the prisma workspace with its devDependencies and loads effect through `@prisma/config`, as the security record states (§2, line 40). The reachability argument, that only our own config file is decoded, is unchanged. | Say "no app runtime image (api, worker) installs it; the Prisma tooling image and lane A load it via `@prisma/config` for our own `prisma.config.ts` only". It is a register text, so the change stays inside this PR's two paths. |
| n2 | NIT | `tools/ci/check-audit.test.ts` PR67-SEC-02 test, second assertion | The non-vacuity guard is pooled: `> 0` across all waived packages. If picomatch ever left the lockfile, the test would still pass on effect alone, and a dead waiver would go unnoticed. The bare `[]` / `> 0` failures also give no hint of what to do. | Assert per waiver, for example `expect(committed.waivers.filter(w => !tuples.some(t => t.name === w.package)).map(w => w.decision)).toEqual([])`, with a comment: "a waiver whose package left the lockfile must be removed". |
| n3 | NIT | process; D-SECAUDIT-02 forcing plan | The only reminder before 2026-12-18 is the gate going red on every open PR that day. | Have the orchestrator add the remediation to STATUS.md (or a chore card) with a target of 2026-12-11, so the bump or override and its lane B run land before the cliff. |

**Observation (pre-existing, not this PR's paths).** The degraded-mode lane A runner `tools/quality/fastlane.mjs` (`FASTLANE_STEPS`, step `npm-audit`) runs a raw `npm audit --audit-level=high`. That step does not read the waiver register, so it reports dev-closure Highs that check-audit waives (picomatch since 2026-11-18, now effect). A degraded-mode record is red for a reason the hosted gate accepts. I route this to the TASK-011 owner / devops: either run `check-audit` in that step or document the difference.

## 5. Merge conditions

- Lane B `unit` evidence on `67c4c04d` (or the head that applies n1/n2), and lane A green, including check-audit with this waiver.
- The security record (PASS_WITH_FOLLOW-UPS) is bound to the merged head.

## GOOD

- The waiver lives in data with a hard expiry, and the gate fails closed by itself at the due date, with no human reminder needed for safety.
- The dev-only claim is turned into an executable lockfile invariant instead of prose, and it is reusable for every future waiver.
- The due-date test is now a table, so the next waiver is one row rather than a copied test.
