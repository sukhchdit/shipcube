---
name: project-p5-task075
description: TASK-075 carrier contract: r1-r4, final @28044845 (96672d8e, D-SECPR075-04) PASS_W_F-U, no open LOW+; INFO 15 + routed items to TASK-113/132/128/orchestrator
metadata:
  type: project
---

TASK-075 (CarrierAdapter contract, guard, normalisation, egress contract). All three rounds were pre-push and recorded on main in `docs/05-quality/security/PR-pending-TASK-075-security-review.md`.
- **Owned path:** only `tools/lint/carrier-wire-boundary.test.ts`. The classifier selects `security-integration` via `packages/config/**`.
- **R1** @`c2eaa47` (D-SECPR075-01): LOW 01-04, INFO 05-09.
- **R2** @`dde830b` (`36b0b21`, D-SECPR075-02): closed 01-08 except the routed parts; new SEC-10 MEDIUM and INFO 11-13.
- **R3** @`82aa275` (`06ee4b8c`, D-SECPR075-03): closed SEC-10 (11/11 operations), 11-13, and code-review R2-m1/n2/n3/n4.
- **R4** @`28044845` (final fix cycle; `96672d8e`, D-SECPR075-04): closed SEC-14 (13/14 label shapes, the EPL residual is stated; 13/13 edge rows); no new finding. Stated edge: a blank lead of more than 1 KiB hides a foreign signature from `isZpl` (twin R4-n1).

Open items:
- **14 LOW (from R3, closed in R4).** `isPdf` accepts `%PDF-` anywhere in the first 1024 bytes, so HTML-, PNG- and ZPL-led payloads pass as PDF. This is a regression of the R1 guarantee. Also, a single leading blank byte moves foreign magic past `isZpl`'s offset-0 check. Fix: allow only blank/BOM bytes before the header (validated 13/14; the EPL residual is D-TASK075-21).
- **15 INFO (from R3).** The caret loop takes 708 ms on 20 MB of `^`. The bound is the ADR-0016 §13 response-size cap, which TASK-113 must set.
- **Routed:** 02 (b) TASK-113, 02 (c) orchestrator CODEOWNERS, 04 (b) TASK-132, 09 TASK-113/128, 12 sentinel test to the public-tracking task.
- **Twin R3-m1:** an adapter that calls `createLabelDocument` inside `createShipment` now ends in EXCEPTION (safe). The fix is a JSDoc line plus a TASK-101 case.

**Why:** the carrier layer is the choke point for CLAUDE.md §5 (no production endpoints before G4), for PII in logs and for duplicate labels. Four adapters build on it next.

**How to apply:**
- C3 requires round 4 on any change to `packages/carriers/src/{guard,errors,labels,egress,context}.ts`. The checker would not demand it, because carriers-only changes keep the binding.
- Probe kit (scratchpad `t075/probes/`, wiped once already):
  - `hooks.mjs` resolves `@platform/*` to the extract and type-strips the sources;
  - `r2-guard`, `r2-rest`, `r2-sec10`, `r3-class`, `r3-labels`, `apply-fix3`;
  - `sim3.sh` replaces ALL Head rows in its T9 control: with several rounds, an un-replaced older Head row still binds and the control falsely passes;
  - `gl-over` / `gl-perfile`.
- Magic-byte sniffers: always probe a foreign magic AFTER a blank/BOM prefix, and a foreign header BEFORE the expected one inside any window.

Related: [[project-p5-wave0-carrier-docs]], [[project-security-review-conventions]]
