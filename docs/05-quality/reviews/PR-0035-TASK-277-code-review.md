# Code review: PR #35, TASK-277 test-ID traceability tooling (round 1)

Reviewer: code-reviewer (principal engineer). Head reviewed: `76808c8` (full SHA `76808c8c35407bd2f3b9c1f6a0cd162e6f66c314`, merge of main at PR #33 into two feature commits). Base: `origin/main` (docs-only drift since the merge, `f2f34a7`).

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: The three tools are correct on the real tree: 200 test files and 363 ID mentions extract with no false positive or negative, quality:trace is byte-deterministic with 0 orphans on the newest stored run, `--run` refuses symlinks, junctions, nesting and outside paths, and the generator reproduces 213 of 218 Must stories byte for byte.
  No BLOCKER or MAJOR. Pinning the five drifted stories is acceptable provided the pin has an owner and the drift is visible in ac-trace.json.
  Six MINORs, mostly unpinned guards (mutants survive) and two metric/default issues (NFR counting; default output inside an evidence run). D-TASK277-03's stated cause is partly wrong.
```

## 1. What I verified myself (and what I did not)

Method: `git archive` extract of the exact head, `node_modules` junction to main, Node 24, no Docker, no builds. Scratch removed afterwards; main `node_modules` still 740 entries; worktrees clean.

| Check | Result |
|---|---|
| Targeted unit: trace, gen-gherkin-map, flake-report, lib/test-ids | 4 suites, 32 tests pass |
| `prettier --check` on tools/quality, package.json, the assignments JSON | pass |
| `quality:trace` on the newest stored run (`20261113T1409Z_e02c4f9`, 3731 cases), twice | `must-AC 62/1593 · NFR 0 verified + 1 partial/91 · SEC-TC 9/64 · 94 IDs · 0 orphans · 0 problems`; the two outputs are byte-identical |
| `gen-gherkin-map --check` on the real repo | exit 1 naming US-066 (12 vs 8), US-121 (7 vs 6), US-129 (10 vs 5), US-137 (8 vs 7), US-222 (10 vs 8) = 13 scenarios; matches the PR body. Parser count 2171 scenarios in 293 stories equals `grep` (2076 Scenario + 95 Outline); no `Example:`/`Scenario Template:` forms exist |
| Real test tree scan (200 `*.test.*` files, lines holding `it/test/describe`) | 363 ID mentions, 122 distinct, all strict; the only non-strict tokens are `AT-US-012-02-object-storage/-redis/-postgres`, which extract to `AT-US-012-02` (correct) |
| IDs used by PR #34's tests (`NT-PRIV-001-a`, `NT-PERF-006-b`) against nfr-traceability.md | known; the two PRs do not create orphans for each other |
| `resolveRunDir` probes (junction, regular file, trailing slash, `..`, absolute, nested, upper-case sha, runs dir itself, outside path, default latest) | only direct, non-symlink `<stamp>_<sha7>` directories accepted; a junction child is refused and also skipped by the default "latest" |
| Mutation run on the PR's own tests (27 mutants over trace, test-ids, flake-report, generator) | 13 killed, 14 survived (2 are equivalent: the nested and absolute `--run` guards are subsumed by the `<stamp>_<sha7>` name test); the rest are listed in R1-m1, m2, m6, n3 |
| Security-owned paths checker (`--pr 35`) | `status: missing`: record `docs/05-quality/security/PR-0035-*.md` required (tools/quality/** and package.json) |
| PR #35 + PR #34 merge | clean |

NOT re-run: Docker-bound lane B (`quality:heavy`), gitleaks, whole-repo lint/typecheck/unit. This PR needs only the `unit` suite; I rely on the author's table for the rest. Lane A on the head is red only at "Lane B evidence" and "Security-owned paths" (expected for a non-docs PR without evidence and record).

## 2. Findings

| ID | Sev | Where | Problem | Required fix |
|---|---|---|---|---|
| R1-m1 | MINOR | `tools/quality/trace.mjs:263` and `trace.test.ts` | The Must-AC numerator guard `s.tests > 0 && s.passed === s.tests` is half unpinned. Mutant `s.passed === s.tests` (drop `tests > 0`) passes all 32 tests, and it would count every Must AC that has no test at all as covered, i.e. 1593/1593 on any run. This is the headline number G3 item 7 reads | A test with a map containing a Must AC without any test, asserting `covered` excludes it, plus a skipped-only and a failing-sibling case |
| R1-m2 | MINOR | `trace.mjs:265-270` | The NFR section undercounts. `partial_evidence` counts only rows whose `Run` is not FULL; a FULL row with some (not all) parts passing is in neither `verified` nor `partial_evidence`. On the newest run 4 NFR rows have a passing NT part (`NFR-AVAIL-003`, `NFR-OPS-005`, `NFR-DATA-004` FULL, `NFR-SEC-007` PARTIAL) but the report says `0 verified + 1 partial`; the printed ratio (`0.011`) also adds "verified" and "partial" into one number. Mutants `s.failed === 0` dropped from `partOk` and `parts.length > 0` dropped from `verified` also survive | `partial_evidence` = rows not fully verified with at least one passing part (any `Run`); report the three as separate numbers and drop the mixed ratio, or name it `evidence_ratio`; tests for the failed-part and zero-part cases |
| R1-m3 | MINOR | `trace.mjs:312` (default `--out`), D-TASK277-03, README §9.1 | The default writes `ac-trace.json` into the stored run directory, while D-TASK277-03 says it is "NOT committed into run directories". Running the tool in place leaves an unlisted file in an evidence folder: `check-evidence` rejects any file without a SHA-256 in `summary.json` (check-evidence.mjs:476-478). The decision's stated cause, "check-evidence rejects unknown files", is inaccurate: `ac-trace.json` and `flake-report.json` are already allow-listed names (`FIXED_RUN_FILES`, check-evidence.mjs:80-81; `heavy.mjs:442-443`). What is missing is the `summary.json` attachment entry that `quality:heavy` would write, and TEST-STRATEGY §6 rule 2 and G3 item 7 expect the file in the run | Default `--out` outside the evidence tree (e.g. `reports/ac-trace.json`, as PR #21 does for `api-contract-coverage.json`) or make `--out` required with a clear message; correct D-TASK277-03 to "needs an attachment hook in `quality:heavy`"; give that hook an owner and a deadline (see 4) |
| R1-m4 | MINOR | `tools/quality/lib/test-ids.mjs:61-66,69-72` | Malformed IDs are invisible. `extractIds` only returns well-formed IDs, so `AT-US-66-01`, `AT-US-066-1`, `SEC-TC-1`, `NT-PERF-6-a` in a title are neither credited nor reported as orphans: "an ID not in the maps fails" never fires for the commonest orphan, a typo. The real tree has none today, which makes it cheap to start strict | Add a malformed-ID scan: a token that starts with `AT-US-`, `SEC-TC-`, `NT-<CAT>-` or `J-` at a word boundary and has no well-formed ID as a prefix is a problem (exit 1). `AT-US-012-02-object-storage` must stay accepted (its prefix is a valid ID) |
| R1-m5 | MINOR | `trace.mjs:68-75` (`mustAc`) and `gen-gherkin-map.test.ts:33` | While the five stories drift, the Must-AC denominator comes from the stale map (1593) not from the story files (1606 G3-counted, 1612 Must scenarios), so the ratio is overstated by the 13 unclassified scenarios, and `ac-trace.json` does not say so. The pin is also an open obligation without an owner or date | In `loadMaps` compute the Must scenarios of the story files that have no map row and emit `coverage.must_ac.unmapped` (count and IDs by story); the gate reader then sees the caveat. Give the pin an owner: STATUS ROUTED + sheet line (see ruling) |
| R1-m6 | MINOR | `trace.mjs:156`, `test-ids.mjs:100-104,241`, `test-ids.mjs:315` | Guards with no test (mutant survives): refusing a symlink/junction `--run` (probed by me: it works), the size cap and regular-file check of `readBounded`, the nfr `Run` value check, the 6-cell and duplicate-ID checks of `parseGherkinMap`, the `RUN_DIR` filter of the default "latest". The PR body lists `--run` containment as tested, but only the name and the nesting forms are | One test each. Symlink on Windows: `fs.symlinkSync(target, path, 'junction')` needs no admin; use it in a `mkdtemp` dir |
| R1-n1 | NIT | `flake-report.mjs:96-111` | Duplicate titles in one file (legal in Jest) form one group; if one of two same-title tests fails in a run, the group has a pass and a fail on the same SHA and is reported as a definite flake (`same_sha_mixed`) although nothing re-ran | Count a same-SHA flake only when the outcomes differ between two observations that cannot be siblings in one run, or de-duplicate by (run, name) first and report duplicates separately |
| R1-n2 | NIT | `flake-report.mjs:42-79` | It reads every stored run (all committed evidence, 5 MB cap each, unbounded in number); `check-evidence` already works on a newest-30 window | `--last N`, default 30, in the docs and the JSON header |
| R1-n3 | NIT | `trace.mjs:195`, D-TASK277-04 | "IDs are also read from `classname`" is vestigial: in lane B JUnit `classname` is the test file path and `name` is Jest's `fullName` (describe titles included, convert.mjs:150-156). Mutant dropping `classname` survives. Harmless, but a file name containing an ID-like token would credit every test in the file | Read `name` only, or keep it and say why |
| R1-n4 | NIT | `trace.mjs:312`, `gen-gherkin-map.mjs`, `flake-report.mjs` | `--out` writes anywhere the invoker can (follows symlinks). It is an operator CLI, not a gate input, so no security finding | Optional: refuse an `--out` inside `docs/05-quality/tests/runs/` |
| R1-n5 | NIT | `trace.mjs:253-264` | An outline counts as covered when the outline ID and its tested `-<row>` IDs all pass, whatever the number of Examples rows; the map does not carry the row count | One sentence in the file header so G3 readers know |

## 3. Rulings on the focus questions

**ID extraction regexes.** Correct on the real tree (section 1). Boundaries are right: no start/end boundary makes the boundary tests fail (mutants killed); `AT-US-001-010` does not match; `AT-US-012-02-object-storage` yields the base ID. The limitation is one-directional (R1-m4: malformed IDs vanish). `J-[A-Za-z0-9]+-\d{2}[A-Z]?` did not produce a false positive on any stored run or the source tree.

**Orphan logic.** Right for well-formed IDs: AT = map rows UNION story-file scenarios (Should/Could are not orphans, D-TASK277-02), an outline `-<row>` is known only when its outline is and the row is at least 1, NT from the Test(s) column parser, SEC-TC adopted and proposed, J from headings with ranges. Exit 1 on orphan and on unreadable or unparseable input, 2 on usage; the unparseable-file message does not echo content.

**Must-AC denominator.** Map rows with `G3 = yes` (1593), live-sandbox excluded. Correct today by construction, and understated by 13 while the five stories drift (R1-m5). Covered = at least one test and all passing, with outline pooling (R1-m1 for the guard test).

**gen-gherkin-map determinism and the KNOWN_DRIFT pin.** Deterministic (sorted by count then first occurrence, no clock). Test 1 renders the committed map byte for byte, but for the five drifted stories it takes the scenarios from the committed map rows (`storiesAsMapped`), so those five are circular; the other 213 are real. Test 3 is a ratchet (`named` must `toEqual` the list), so fixing a story or drifting a new one fails lane A at once, and the list cannot go stale. **Ruling: pinning is acceptable now, fixing now is not in scope.** Reasons: the correction needs a qa-lead classification of 13 scenarios and a product-manager decision, and `quality:gherkin-map` would rewrite the map and so renumber IDs that tests already carry. The sheet AC ("regenerates ... identically", drift test) is therefore met for 213 of 218 Must stories and the PR says so openly. Conditions: (a) an owner and a date (before the Wave-0-exit activation PR, because US-066 IDs already mean two scenarios in two tests: `roles.test.ts` follows the map, `authorise.test.ts:13` follows the story); (b) R1-m5 so ac-trace.json shows the caveat; (c) a recommendation for the owner: the map's own stability rule says new scenarios are **appended** to the block and never inserted. The five story files broke it (D-058/D-060). The least disruptive fix is a docs-only product-manager edit that moves the inserted scenarios to the end of each block, which restores every existing ID without touching a test, then qa-lead classifies the 13 new IDs, runs `quality:gherkin-map` and empties `KNOWN_DRIFT`. The alternative (renumbering the US-066 test titles) moves more code.

**flake-report grouping.** (suite, classname, name) is stable in lane B (`classname` = file path, `name` = `fullName`); parametrised titles with dynamic values would form a new group per run and never flag (acceptable, document it). Same-SHA vs cross-SHA split is right; skips ignored; exit codes right (`--fail-on-same-sha`). R1-n1/n2.

**`--run` path safety.** Verified by probe (section 1): a single `<stamp>_<sha7>` segment under `docs/05-quality/tests/runs`, `lstat` non-symlink directory, so junctions and symlinks are refused (and skipped when defaulting), absolute and `..` forms that resolve to a direct child are fine, anything else exits 2. Input reads are bounded and symlink-free (`readBounded`). Untested guards: R1-m6.

**Exit codes.** Trace: 0 ok, 1 orphans or problems or MapError, 2 usage or internal. Generator: 0, 1 drift/unclassified, 2 usage. Flake: 0, 1 problems or flakes with the flag, 2 usage/internal. Consistent with the headers and tested for orphan and problem paths (mutants killed).

**ac-trace.json not committed (D-TASK277-03) and G3.** Consequence: the committed run directories contain no `ac-trace.json`, so TEST-STRATEGY §15 items 6, 7 and 17 (SEC-TC, Must-AC, flakiness evidence read from `ac-trace.json` / `flake-report.json` "in the run") have no attested artefact: nothing hashes it in `summary.json`, and no CI step or `quality:heavy` call produces or enforces it (the orphan rule fires only when someone runs the command). The output is deterministic and carries the maps' SHA-256s, so the gatekeeper can regenerate it from the run and the maps at the gate SHA; that is acceptable as an interim, not as the G3 evidence design. The hook (attach `ac-trace.json` and `flake-report.json` to `summary.json` in `quality:heavy`, run `quality:trace` for the wave/gate profiles, fail on orphans) is a `tools/quality` change owned by 015-B/C or the activation PR; see merge conditions.

**D-ORCH-038 / D-ORCH-040.** Met: tests only delete `mkdtemp` directories they created (`afterEach` per temp), and the branch does not edit DECISIONS.md or STATUS.md.

## 4. Follow-ups to route

| Item | Owner | Due |
|---|---|---|
| Classify the 13 scenarios, fix the five stories (append rule), run `quality:gherkin-map`, empty `KNOWN_DRIFT` | product-manager + qa-lead | before the Wave-0-exit activation PR |
| `quality:heavy` hook: attach `ac-trace.json` / `flake-report.json`, run trace for wave and gate, fail on orphans | devops-engineer (015-B/C or the activation PR) | before G3 |
| Activate the `ac-trace` and `flake-report` manifest entries (currently `planned`) | qa-lead | with the hook |
| Correct D-TASK277-03 wording on main (orchestrator appends decisions, D-ORCH-040) | orchestrator | on merge |

## 5. Security flags

None new. `tools/quality/**` and `package.json` are owned paths: record `docs/05-quality/security/PR-0035-*.md` naming the final head. Reads are size-capped, symlink-refusing and never echo file content; the writers take an operator-chosen `--out` (R1-n4).

## 6. Merge conditions

1. A security record on the final head; fresh lane-B evidence once Docker is back (`quality:heavy --profile pr`, `unit` suite only needed) on an ancestor of the final head, no later non-docs commit.
2. R1-m1 and R1-m3 fixed in this PR (cheap and they affect what G3 reads); R1-m2, m4, m5, m6 in-PR or routed with the owners in section 4. If R1-m5 is not done, the pin needs the owner and date recorded in STATUS ROUTED before merge.
3. The routed items of section 4 recorded in STATUS (orchestrator).
4. Squash with a conventional-commit title. No overlap with PR #34 (clean merge); PR #32 conflicts come from main, not from this PR.

## 7. Good

- Pure Node, no new dependency, no workflow change, bounded and symlink-free reads, output with IDs and counts only (no titles, no messages, no host paths).
- Deterministic JSON (sorted keys, no timestamps) with the SHA-256 of every map embedded.
- The drift test is a ratchet that cannot go stale, and the PR reports the pre-existing drift instead of hiding it.
- The assignments file separates the qa-lead judgement (suite per scenario) from the derivable part (positions, lanes, DC, live-sandbox).
- `-b` shorthand in the NFR table is parsed only right after `· `, so command flags in prose do not become parts.

## 8. Handoff

Verdict APPROVED_WITH_NITS: no BLOCKER or MAJOR. Round 2 only if the author wants the delta checked (R1-m1, R1-m3 mutants and the default `--out`).
