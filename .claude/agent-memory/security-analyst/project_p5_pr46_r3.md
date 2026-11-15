---
name: project-p5-pr46-r3
description: PR #46 delta round 3 + merge-only @4bbce92 (fix cycle 2 proof binding + union with #42) PASS_WITH_FOLLOW-UPS; SEC-13 closed; new INFO 15 pull-requests scope, 16 proofs not bound to tested base; #39 merged mid-round so a #39 union + merge-only round (R3.9) is owed; GitHub API facts for proof binding
metadata:
  type: project
---

Section "Delta round 3 + merge-only" appended uncommitted (LF, 900 lines total) to `docs/05-quality/security/PR-0046-TASK-015B-security-review.md` in worktree `Shipqube-TASK-015B` on 2026-11-15. Head row `4bbce92ff4d9…`; proposed D-SEC-PR46-03.

**Closed:** PR46-SEC-13 (code R2-M1). 51-case binding matrix: all 45 negatives refused, 6 controls accepted; on `ad30316`, 42 of the 45 were proofs. 8 of 8 fix mutants caught.

**Rulings:**
- D-TASK015-64/66/67/68/69 accepted.
- D-TASK015-65 accepted: I withdrew my R2 ancestry sub-item.
- R2-m2 (devOptional) routing to SHEET-FOLD-8 accepted.

**New INFO:**
- 15: `pull-requests:` is not confined like `actions:` (a workflow-level read and a lane-c job read pass).
- 16: proofs are not bound to the base the proof run tested, so P1 stays procedural. Both are routed to TASK-286.

**PR #39 merged at `3f58935` during the round** (D-ORCH-093). It overlaps five owned paths: jest.config.ts, package.json, check-workflow-policy.mjs (+test), rebuild.mjs. Its ci.yml did not change.
- The merge tree with `8c65315` is clean (`7600a9d`). Sim G: the real union voids the record.
- The next round is a merge-only round against record R3.9: the union's ci.yml must equal 4bbce92's byte for byte, and both sides' symbols must be kept.

**Live prediction for the record push** (verify against the scans summary):
- light;
- identical = record, 4bbce92, 6a845d6, 0f17495;
- code_proof `43687170281:4bbce92…`, no note, 7 API calls;
- security_integration_due=true; MERGE-READY only if security-integration succeeds.

It is NOT a merge authorisation (P1).

**GitHub facts (verified 2026-11-15):**
- A run's `pull_requests` entries reflect the PR's CURRENT state. Run 43609726745 (on ad30316, base d753027) lists head.sha 4bbce92 and base.sha 5d2c102. The entries' repo objects carry only id/url/name, no full_name.
- `pulls?state=all&head=<owner>:<branch>` still lists closed PRs whose head branch was deleted (#41, #29, #22).
- `base_ref_changed` is in the Issue events API for PRs.
- Endpoint scopes:
  - the pulls list needs Pull requests read;
  - issue events accept Issues read OR Pull requests read (installation tokens).
- Run schema: `run_started_at` "Resets on re-run"; `created_at` is the creation time. No re-run exists in this repo to confirm live.
- A conflicting PR gets no `pull_request` run at all.
- docs.github.com: WebFetch is blocked or resets, but `curl -sSL` to the page works. Grep the embedded JSON schema.

**Kit (session scratch `r3/`, may vanish):**
- `p-bind.mjs`: fake API seeded with the real run and jobs JSON. Head and previous head run side by side; an optional argv[3] takes a mutant module.
- `mk-mut.mjs`: the 8 mutants.
- `p-policy.mjs`: Y1-Y21.
- `record-sim3.mjs`: 17 scenarios. The `--lookup` mode calls the head's `main()` CLI with real `gh`, with GH_TOKEN deleted from the child env.

**Gotchas:**
- A fake-API default that returns no runs makes every negative case vacuous. Print the API-call count per case: 1 call means nothing was exercised.
- A Bash heredoc again turned `\\b` in a template-literal RegExp into a backspace. Do ID renames with `sed -E 's/\bW([0-9]+)\b/Y\1/g'`.

Related: [[project-p5-pr46-r2]], [[project-p5-pr46-015b-lane-c]], [[project-p5-pr39-mo]], [[project-security-review-conventions]]
