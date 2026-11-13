---
name: project-p5-threat-model-v11-round
description: Threat-model v1.1 text round 2026-11-13 (D-SEC-TM-01, uncommitted when written): sheet-fold 3/4 wording folded; proposed SEC-TC-69..75 with owners; 65-68 still provisional; -bench vocabulary aligned; what stays open
metadata:
  type: project
---

`docs/03-architecture/threat-model.md` is now v1.1 (header "Revisions" row, new §10.4 A-G amendments log, AC-57, RR-16..18). Decision D-SEC-TM-01 in `docs/sdlc/DECISIONS.md`. Docs only; not committed by me; no manifest, ADR, data-model, record or STATUS edit.

**Proposed IDs (catalogue section "Proposed cases SEC-TC-69..75" in `docs/05-quality/tests/security-test-cases.md`, NOT in `required-suites.json`):** 69 anchor pre-seed + compare branches (TASK-116), 70 anchor sink error classes incl. 409 (TASK-116), 71 anchor credential pair (TASK-116 + TASK-014 `CREDENTIAL_PAIRS`), 72 CIC leftover family on clone DBs (TASK-033 tests, TASK-090 runbook), 73 rule 11 (c) (TASK-024), 74 forged-stamp matrix C15 (d) (TASK-024; merge condition for TASK-037), 75 storage policy / `allowInline` (TASK-147).

**Why 69 and up:** SEC-TC-65 (P3 review §16.4, SEC-FU-QA), 66/67/68 (PR #6 review) are provisional IDs still unadopted. Next free ID after this round is 76. Check with a repo-wide grep before minting.

**Facts worth keeping:**
- The model keeps no per-threat IDs for post-G2 limits; they live in §10.4 and RR rows so threat counts and ratings stay stable.
- PR24-SEC-10, PR24-SEC-11 (resolved by rule 11 (c)), PR26-SEC-03 (resolved by D-ARCH-091), PR27-SEC-05 text half and PR3-SEC-11 are recorded there; the security records themselves were NOT edited (lane A reads them).
- Still owed outside the text: `-bench` build profile (TASK-030/TASK-280); a `check-workflow-policy` case for `-bench` push/deploy; `k6-audit-ab` runner string in `tools/quality/required-suites.json` still says `APP_ENV=benchmark` (qa-lead); PR30-SEC-04 config half (TASK-014).

**How to apply:** when reviewing TASK-116/033/090/024/037/147/014, check the matching SEC-TC row and §10.4 item, and that the case moves into `required_cases_pending` or `required_cases` with the right checkpoint (qa-lead). Do not mint a new SEC-TC ID without the grep.

Related: [[project-p5-pr24-audit-store]], [[project-p5-pr26-standard-columns]], [[project-p5-pr27-spk04-spike]], [[project-p5-pr30-s3-adapter]], [[project-p3-security-conditions]]
