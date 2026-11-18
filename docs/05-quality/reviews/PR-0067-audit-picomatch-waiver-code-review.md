# Code review: PR #67, time-boxed waiver for picomatch GHSA-fc5q-39xc-vjpf (D-SECAUDIT-01), round 1

Reviewer: code-reviewer (principal engineer), acting as the independent reviewer. The security analyst authored the PR. Head reviewed: `1f9c81f` (full SHA `1f9c81f369ea8029f471b64a9eb87c3f227d17bf`, branch `chore/audit-watch-picomatch`). Diff base: `git diff origin/main...1f9c81f` (merge base `982cb7f`). There is one commit, and it changes 2 files: `tools/ci/advisory-watchlist.json` (+10/-1) and `tools/ci/check-audit.test.ts` (+29/-14).

Inputs:
- D-SECAUDIT-01 (`docs/sdlc/DECISIONS.md`, line 3490 on main `a750c97`);
- the security record `docs/05-quality/security/PR-0067-audit-picomatch-waiver-security-review.md`;
- `tools/ci/check-audit.mjs` and `tools/ci/dep-gates-lib.mjs` at the head;
- `.github/workflows/ci.yml`, the "Vulnerability audit" step;
- CLAUDE.md §5 (Dependencies) and US-048 AT-US-048-06/07.

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: The waiver is correctly scoped. It covers one GHSA and one package; the decision ID passes DECISION_ID; it spans
  86 of the 90 allowed days; and it matches both scanners' key (lane A on the head: check-audit PASS, `audit/waived …
  (npm audit + osv-scanner)`). The test changes do not weaken the checker's coverage. The empty-waivers pin becomes an exact
  tuple pin, and the CLI's move to `--now 2026-11-18` is forced and changes no assertion. Every date is a literal. There is no
  BLOCKER or MAJOR. One MINOR: the waiver also passes a production-closure advisory, and the new test's name suggests
  otherwise (this concurs with PR67-SEC-02, already routed). Three NITs.
```

## 1. What I verified myself (and what I did not)

Host rule: a lane-B run holds this machine, so I did a static review only. I ran no `npm test`, typecheck, lint, build or Docker. I wrote one cheap read-only Node probe: `git archive 1f9c81f tools/ci` into the session scratchpad, which imports the head's `check-audit.mjs` directly. It loads no Jest and no node_modules. I did not run the test file. For 28/28 and the mutants M1/M2 I rely on the security record's evidence, and the lane B `unit` evidence is still owed (§5).

| Check | Result |
|---|---|
| Diff scope (`git diff --stat origin/main...1f9c81f`) | 2 files, as declared. No open PR touches `check-audit*`, `advisory-watchlist.json` or `dep-gates-lib.mjs`, so there is no union risk |
| Waiver shape against `validateWaiver`/`loadWatchlist` (`check-audit.mjs:62-97`) | All 6 required fields are present. `D-SECAUDIT-01` matches `^D-[A-Z0-9]+-\d+$`, while `D-SEC-AUDIT-01` does not (probe), so the ID choice is right. The span is `2027-02-12 − 2026-11-18` = **86 days**, which is ≤ 90 |
| Probe: the committed register at the real gate's semantics (`loadWatchlist(reg, now)` + `checkAudit`) | `2026-11-17T23:59:59Z` → exit 2 ("granted … is in the future"). `2026-11-18T00:00Z` → pass. `2027-02-11T23:59:59Z` → pass. `2027-02-12T00:00Z` → `audit/waiver-expired`. A lower-case id still matches (case-insensitive). Package `micromatch` with the same GHSA → `audit/high`, so the waiver does not leak to other packages. **`production: true` → still waived** (R1-m1) |
| GHSA charset vs `ghsaOf` (`check-audit.mjs:100`) | `fc5q`, `39xc` and `vjpf` all fall within `[23456789cfghjmpqrvwx]`, so npm audit's `via.url` maps to the waiver's id rather than `npm-<source>` |
| Lockfile closure (head `package-lock.json`, parsed) | There are 3 tuples: `node_modules/picomatch` 4.0.7, `anymatch/node_modules/picomatch` 2.3.2 and `micromatch/node_modules/picomatch` 2.3.2. All are `dev: true`; none is `devOptional`, `optional` or `peer`. `mergeAdvisories` keys on id\|package, so all three collapse into one advisory and one waiver covers them |
| `maintenance-exceptions.json` | Holds only `bcrypt` and `node-abort-controller`. picomatch has no exception, so the D-ARCH-003 rev 4 item 4 void does not apply |
| How the real gate gets `now` (`ci.yml` "Vulnerability audit") | `node "$GATE_CHECK_AUDIT" … --npm-audit … --osv …` passes no `--now`, so the runner clock decides. The test-only `cliNow` therefore cannot leak into the gate |
| Lane A run 44297523492 on `1f9c81f` | The "Vulnerability audit" step logs `note audit/waived: GHSA-fc5q-39xc-vjpf picomatch (high, dev closure, fix available): tracked by D-SECAUDIT-01, due 2027-02-12 (85 days) (npm audit + osv-scanner)` and `check-audit: PASS`. `fast-lane` is red only at "Lane B evidence" (no accepted `unit` run). `ci-gate` is red only at "Security-owned paths need a review record", because the run (11:45Z) predates the record on main. Both are expected (§5) |
| Other consumers of the committed register | `git grep` shows that only `check-audit.test.ts` loads `tools/ci/advisory-watchlist.json`. `sec-static.test.ts` passes its own `waivers: []`/fixtures and is unaffected |

## 2. Test-change weakening analysis (the specific question in the dispatch)

**Old pin `expect(committed.waivers).toEqual([])` → `check-audit.test.ts:76-78` exact tuple pin.** This is not a weakening. The old pin failed on any added waiver. The new one fails on any added or removed waiver and on any change to `id`, `package`, `decision`, `granted` or `expires` of the one entry. `reason` is not pinned, but the checker never reads it, so no gate-relevant property escapes.

**CLI `--now 2026-11-12` → `cliNow` (`:196`, used at `:199` and `:209`).** This is not a hidden weakening:
- **Forced.** Run at 2026-11-12, the committed register (granted 2026-11-18) would exit 2 (`check-audit.mjs:75-76`), and both CLI tests would fail.
- **No assertion depends on the date.**
  - The watch `review_by` dates are all 2027-02-12, so no `watch-review-due` note appears at either date. Even if one did, it would be a stdout note, and the tests assert `stderr === ''`, the status and specific stdout/stderr lines.
  - Neither `npm-audit.clean.json`/`npm-audit.high.json` nor `osv.json` contains picomatch, so the CLI exit codes and lines are the same at 11-12 and 11-18.
- **The m7 CLI rows (`:221-241`) still run at the literal `2026-11-12`** against their own fixture registers. The future-grant rejection is still pinned by the unit row at `:172`.
- **Self-adjustment is bounded.** `cliNow` derives from the committed register, so a pre-dated waiver would move it forward silently. The exact pin at `:76-78` fails in that case, and the real gate uses the runner clock and exits 2. See R1-n1 for a readability tweak.

**New test `[D-SECAUDIT-01]` (`:81-98`).** It has real value. The failing-side assertion at exactly `2027-02-12T00:00:00Z` distinguishes `>=` from `>` in `isExpired` (`dep-gates-lib.mjs:174-176`). It also exercises the committed entry, so a typo in id, package or decision fails here and not only in lane A. Its weaknesses are R1-m1 (the name) and R1-n2 (the passing side is far from the boundary).

**Determinism.** Every date is a literal (`2026-11-18T12:00:00Z`, `2027-02-12T00:00:00Z`) or comes from the committed register. The `reduce` compares YYYY-MM-DD strings lexicographically, which is a total order for this format. There is no wall-clock read.

## 3. Findings

| ID | Severity | file:line | Problem | Why it matters | Fix |
|---|---|---|---|---|---|
| R1-m1 | MINOR | `tools/ci/check-audit.mjs:250-269`; `tools/ci/check-audit.test.ts:81` | The waiver matches on `id`+`package` in any closure. My probe passes the same GHSA with `production: true` and gets it waived. The new test's title says "passes the dev-only High", which reads as though dev-scoping is enforced and tested, but the fixture only sets `production: false`. The waiver's whole justification ("Dev-only … npm ls --omit=dev is empty") is not machine-checked for 86 days | If a runtime dependency began to pull picomatch (tinyglobby, chokidar and fast-glob are common runtime deps), the High would stay silently waived in the production closure. The only control left is the procedural CODEOWNERS one on `package.json`/lockfile | **Concur with PR67-SEC-02** (owner devops-engineer via senior-developer, before the next waiver and at the latest by 2027-02-12). This is not a merge condition. Optional in this PR: rename the test to "…passes the picomatch High (any closure, see PR67-SEC-02)…", or add a characterisation line asserting the current `production: true` behaviour, to be flipped when SEC-02 lands, so the gap is visible in the suite |
| R1-n1 | NIT | `tools/ci/check-audit.test.ts:194-196` | `cliNow` is self-adjusting. It is safe only because `:76-78` pins the exact grant date, and the comment does not say so | A future editor who relaxes the pin to a shape check (likely when waivers rotate) would let a pre-dated waiver move the CLI tests' clock with it, unnoticed | Either use the literal `'2026-11-18'` with a comment pointing at the pin, or extend the comment: "safe because the tuple pin above fixes every `granted`; the real gate uses the runner clock" |
| R1-n2 | NIT | `tools/ci/check-audit.test.ts:93` | The passing side is asserted at `2026-11-18T12:00Z`, 86 days before the boundary | An off-by-one-day mutant (for example, expiry treated as 00:00Z of the previous day) survives this test. The `>=` vs `>` mutant is caught by `:96` | Assert the passing side at `2027-02-11T23:59:59Z` as well (my probe shows it passes) |
| R1-n3 | NIT (info) | `tools/ci/check-audit.mjs:136,204`; `check-audit.test.ts:88` | The lane A summary labels this no-fix advisory "fix available", because npm's `fixAvailable` is a semver-major `jest-util@26.6.2` downgrade, OR-merged with osv's `false`. The fixture's `fixAvailable: true` faithfully reproduces the real merged value | It is misleading in the step summary. The waiver path does not depend on it | No change here. This is PR67-SEC-03 (INFO, optional), pre-existing |

No deviation rulings were requested.

## 4. Requirements and guardrails

- **US-048 AT-US-048-07:** this is the right instrument. A watch entry cannot clear a High (`check-audit.mjs:231-256`: watched is a note and the High still goes to `audit/high`), so only a dated waiver tracks a no-fix High. The expiry re-fails the finding on its own.
- **CLAUDE.md §5 Dependencies ("no Critical/High … otherwise choose an alternative or implement in-house"):**
  - No dependency is added or changed.
  - No fixed release exists (4.0.7 is the latest release and in range).
  - The consumers are fixed-stack tools (Jest, Vite, React Router dev, Stylelint, ESLint plugin), so "choose an alternative" is not available under §2.
  - The §5 safe-alternative clause applies: a time-boxed, CODEOWNERS-reviewed, self-expiring waiver, logged in DECISIONS.md as D-SECAUDIT-01. I concur with the security record.
- **G3 note for quality-gatekeeper:** O5 requires "0 open Critical/High". This advisory is rated LOW in context and waived until 2027-02-12, after the G3 window. The gatekeeper should list it as a waived item and not count it as open.
- **Scope:** there is no scope creep. The commit message and D-SECAUDIT-01 describe the diff exactly.

## 5. Merge conditions

1. Accepted lane B `unit` evidence bound to `1f9c81f`, or to a descendant whose only changes are the evidence directory. `check-audit.test.ts` is outside the staleness allow-list (run 44297523492: "no accepted lane B evidence for required suite(s): unit").
2. A new `pull_request` event on the final head, so that `ci-gate` reads the PR-0067 security record now on main (`a750c97`). That run must show `fast-lane` and `ci-gate` green, with `check-audit: PASS` still showing `audit/waived`.
3. After merge, other open PRs (#66 per D-SEC-PR66-01 condition 2, and every PR that went red at the audit step since 2026-11-17) need a new `pull_request` event. A re-run of an old run reuses its old merge ref.

## 6. Follow-up ownership

| Item | Owner | Due |
|---|---|---|
| R1-m1 / PR67-SEC-02: bind waivers to the dev closure (`closure: "dev"` enforced in `checkAudit`, or a committed-lockfile invariant test) | devops-engineer via senior-developer | before the next waiver is added, and by 2027-02-12 at the latest |
| PR67-SEC-01 re-check: `npm update picomatch` and remove the waiver in the same PR | security-analyst | 2027-02-12, or earlier when picomatch ships a release outside the range |
| R1-n1, R1-n2 | the PR author (optional in this PR) or the PR67-SEC-02 change | none |

## 7. Good

- The commit message and D-SECAUDIT-01 explain why the waiver is not a watch entry and why the ID is not `D-SEC-AUDIT-01`. Both are non-obvious failure modes, each a lane-A-wide exit 1 or exit 2.
- The expiry boundary is asserted at exactly 00:00Z of the due date, which pins `>=` and not just "some later date".
- The waiver's expiry is aligned with the existing glob/minimatch watch reviews (2027-02-12), so one review date covers the whole dev-glob cluster.
- The real lane A run proves that both scanners map to the waiver's key. That is the one property a unit test with a hand-built advisory cannot prove.

SECURITY-FLAGS: R1-m1 (= PR67-SEC-02, already owned). Nothing new for security-analyst.
