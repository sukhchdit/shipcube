---
name: project-p5-task040b1
description: TASK-040 part 040-B PR 1 security round 1 at stacked head a4aadd2e = PASS_W_COND (main 6b2c6a7f, D-SECPR040B1-01); PR040-SEC-10 LOW lease gap, 11-13 INFO; D-ORCH-158 merge rule refined (explicit merge base); C1-C5 and next-round checks
metadata:
  type: project
---

Round 1 of TASK-040 part 040-B, first PR (lease rule, HKDF keys, sealed envelope, PR040-SEC-09, contract pins) = **PASS_WITH_CONDITIONS**, bound to `a4aadd2e` (delta `0f0d92a0..a4aadd2e`, 15 files, 14 owned). Record `docs/05-quality/security/PR-pending-TASK-040B1-security-review.md` + D-SECPR040B1-01, committed on local main `6b2c6a7f` (2026-11-21, not pushed). Code review twin: `PR-pending-TASK-040B1-code-review.md` (`43c010d1`).

- **IDs continue the TASK-040 series:** PR040-SEC-10..13 (part A had 01..09).
- **Closed:** 01 (HKDF only; raw material no longer opens a body), 02 (envelope + `ck_idempotency_keys__completed_body`), 07, 09; 04 closed as ruled.
- **PR040-SEC-10 LOW (CWE-667) = code review R1-m1.** Amendment 10 counts stretches from the COMMIT of the writer, but `lease_until` is computed at the write (up to `timeout` earlier). Read-only stretch `timeout + 3T` vs lease `3T + 1 s`: margin +5.5 s at 5 s (admission 250 ms), −0.5 s at 7 s, −114 s at 120 s. Effect: second e-mail + DOWNLOAD entry of `emailShipmentDocuments` for the same caller. Ruling input: (a) `max(D+T, timeout+3T, 3T+1s)+5s` (defaults unchanged at 32.25 s), (b) renewal before the VIEW entry, (c) config ceiling (not recommended). Architect ruling = C1.
- **INFO:** 11 non-JSON 2xx on a read-only route silently loses idempotency (refusal after COMMIT; fourth contract pin = R1-n4); 12 pin (a) keys on "public" not "network-scoped" (document-level `security: []`, signature/refresh-cookie schemes); 13 `packages/config` register row/description stale vs ADR-0018 am. 9 (before G3, owner from orchestrator).
- **D-ORCH-158 refined.** "Every conflicted file to the stacked blob" breaks once main changes a predecessor path after the squash: at `61c53b5e`/`4ba683ad` it would drop #81's `pricing_config_versions` grant block from `grants.manifest` and revert #82's `pipeline-guards.test.ts`. Use `git merge-tree --write-tree --merge-base=<predecessor head> <stacked head> <main tip>` (clean: tree `206bfdfb` at `4ba683ad`), or stacked blob only for `git diff --name-only <pred> <stacked>` files. The raw-diff equality (`diff --raw main..merge` = `diff --raw pred..stacked`) is the proof and caught the wrong form (17 vs 15 lines). Merging `763800f3` first, then the tip, gives the same tree.

**Why:** main moved from `43c010d1` to `4ba683ad` during the round (user merged #80-#84 with CI billing-blocked, D-ORCH-162), and R1-m2's migration collision became real (TASK-080's `20261121000000_pricing_config_versions` is on main).

**How to apply:**
- Next rounds: C2 delta round on the fix head (R1-m2 re-time + any PR040-SEC-10 fix + NITs); C3 merge-only round with §6 checks 1-5 (which #80 paths main changed; explicit-base tree + equality; migration sorts last; gitleaks of the merge's first-parent diff with ~51k added lines incl. #81-#84 code that never had lane A; Head row = merge commit); C4 lane B/hosted CI/rename; C5 no store wired before PR 2.
- PR 2 checks: P-1..P-5, purge with the wiring, Pino `IdempotencyLog` class-only, `admissionWaitMs` from the resolved admission options, PR040-SEC-10 fix if not done in PR 1.
- Probe kit (session scratch `t040b1sec/probes/`, may vanish): `hooks.mjs` (registerHooks; `@platform/*` → extract; bare packages fall back to main's `apps/api/package.json`), `p2-lease`, `p3-envelope` (tamper matrix, run on head and base), `p4-keys` (WebCrypto HKDF oracle + RFC 5869 TC3 control), `p5-pins`, `p6b-migration` (PGlite, fresh DB per case), `record-sim.sh` (`SQ_OVERRIDE=<main tip>`), `gl-over.mjs` (multi-line `keywords = [` arrays must be parsed or the 40-hex Head SHA hits `sourcegraph-access-token`).

Related: [[project-p5-task040]], [[project-p5-task041b]], [[project-p5-task080]], [[project-security-review-conventions]]
