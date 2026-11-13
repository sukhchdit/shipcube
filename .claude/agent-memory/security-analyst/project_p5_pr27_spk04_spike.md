---
name: project-p5-pr27-spk04-spike
description: PR #27 (TASK-018 SPK-04 audit write spike) R1 @aa1cfb1 and R2 @a5cfd4b (merge + delta) both PASS_WITH_FOLLOW-UPS; 02 closed, 01 LOW open (TASK-014), 03/04 TASK-280, 05 text half closed, new 06 INFO; k6 digest facts; checks owed in TASK-014/030/033/280
metadata:
  type: project
---

The PR #27 review (TASK-018, spike, test-only) is `docs/05-quality/security/PR-0027-TASK-018-security-review.md` (R1 committed on main in 9d188fd; R2 appended uncommitted 2026-11-13). Only owned path: `eslint.config.mjs` (6-line `tests/load/**/*.js` k6 block).

**R1 @aa1cfb1** PASS_WITH_FOLLOW-UPS (effective-config diff 49 paths: 3 differ, 0 rules; k6 digest verified; evidence clean).

**R2 @a5cfd4ba91faf451d4c494f6406da51f3983be15** (merge + delta) PASS_WITH_FOLLOW-UPS. Why a round: merges of main brought PR #24's removal of the 3-line SPK-08 exemption, so the file differs from aa1cfb1 and R1 was void; lane A run 43413885157 failed ONLY on the record step (fast-lane, Gitleaks, Semgrep green).
- **Merge-only facts:** head blob `9301f8b` equals `git merge-tree` of aa1cfb1 with main (a789a40, e5efbe9, 88f8235); main's blob `b782cfc`; 2-dot diff vs main = exactly +6 lines; 55-path effective-config diff = 3 differ, 52 identical, 0 rule leaves; mutation control 7. Merge commits resolve only `DECISIONS.md` (+67/-0 vs merge base).
- **Findings after R2:** PR27-SEC-01 LOW open (TASK-014; plan complete in D-ARCH-100 item 3, WAVE-00 sheet "DOCKER CONTEXT HYGIENE", platform.md §3.2; still no Dockerfile/.dockerignore). 02 CLOSED (runner asserts product state: no RLS on audit_entries, tgenabled/evtenabled 'A', eight 42501 legs, vacuity guard, fail-closed `INTEGRITY_FAILED`; residual TRUNCATE legs -> TASK-033/280). 03/04 INFO open, owned by TASK-280 (D-ARCH-100 item 4); the WAVE-02 sheet says the SPK04_BIND/env-allow-list edits are made "if server.ts/runner.ts are touched before deletion" and the fix cycle touched both (I recommended the two edits, not a condition). 05 text half closed (threat-model v1.1, nfr-traceability), control half open for the first PR adding `-bench`. NEW 06 INFO: `paths.test.ts` tripwire scans only apps+packages; lint has no rule stopping `prisma/seed` from importing `prisma/tests/**` (probe: 0 messages vs 3 for a bcrypt import in the same file); fix = add `prisma/seed` and `tools` scan roots (verified 14/14 pass, planted import fails).
- **Record-sim (21 scenarios):** A/A1/A2/D-D4/F/G2 pass; A0 (R1 only), B, C, E, E2, F2, G, G3, I, I2, I3 missing. Case F (merge of current main) passes because main's eslint is unchanged; **open PRs #20 and #32 also edit `eslint.config.mjs`** - whichever merges later needs a merge-only round (text merge with #27 is conflict-free for that file).
- **Evidence:** lane B run `20261113T1042Z_b13a6d6` accepted by the base-ref checker (profile pr, 0 problems); count-only host scan 0 hits; Gitleaks emulation 0 over all 30 files' added lines.

**Facts verified 2026-11-13. Re-verify before relying on them.**
- **k6 pin:** `grafana/k6@sha256:5221b620...` is an OCI index (sha256 of body equals digest), amd64/arm64 image manifests identical to the moved `2.2.0` tag, user 12345, created 2026-08-10. Registry probe needs no Docker: anonymous token from `auth.docker.io`, GET manifests at `registry-1.docker.io`.
- **Effective-config diff method:** `calculateConfigForFile` over ~55 paths on two `git archive` extracts (eslint.config.mjs, tools/eslint-rules, tools/lint, all workspace package.json) with a node_modules junction; scrub the root path in values AND object keys (the `import/resolver` key holds the root); mutation control (widened glob + rule off). Non-type-aware harness lint: run in a `git clone --shared` full tree with `overrideConfig: [{...tseslint.configs.disableTypeChecked, files}, {parserOptions.projectService:false, rules:{import-x/no-unresolved off}}]`.
- **Scratchpad is per-session** (earlier PR-27-sec scripts were gone); reusable still: `review/PR-31-sec/gl/gl-emul.mjs`, `probes/hostscan.mjs`, `file-hostscan.mjs`, `scen.mjs`, `mkjunction.mjs`. R2 scripts lived in `review/PR-27-r2/probes` (effcfg, lintts, record-sim27).
- The recorded 223,118-entry integrity results are for the SPK-08 prototype store (deleted by PR #24); SPK-04 is NOT DEMONSTRATED / INCONCLUSIVE and proves nothing about the product store.

**Why:** the image-exclusion gap (01) is the one item nobody else tracks, and 06 is the same class (test code importable by the seed lane) closed for good by the TASK-014 `**/tests` ignore plus explicit COPY lists.

**How to apply.**
- **TASK-014 review:** `.dockerignore` matcher test names the harness paths; no `COPY .` or bare `COPY prisma`; image `find` for `*/prisma/tests*`, `*/tests/load*` empty for every image.
- **TASK-280 review (port and delete the harness):** canary-variable test on the child env, constant loopback bind, k6 flags (`--cap-drop=ALL --security-opt=no-new-privileges --read-only --tmpfs /tmp --pids-limit=256 --memory=1g`, user-defined network, `--pull=never`, one digest constant), product-state integrity incl. TRUNCATE legs, fail-closed, host-scan any re-run's evidence.
- **TASK-030 review:** nothing imported from `prisma/tests`; `lock_timeout` via `set_config(..., true)`; 503 `AUDIT_LOCK_TIMEOUT` generic; rollback fail-closed.
- **Any PR that merges #20/#32/#27 second:** merge-only security round for `eslint.config.mjs` (clause (d)).

Related: [[project-p5-pr12-spk08-audit]], [[project-p5-pr24-audit-store]], [[project-p5-pr25-ci-followups]], [[project-security-review-conventions]]
