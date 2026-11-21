---
name: project-t39-denial-budget-ruling
description: D-SECT39-01 (2026-11-19, commits f3c581f + 631cbc4 on main) T-39 aggregated PERMISSION_DENIED shape for TASK-041; closed details set, key grammar, carry claim, fallback event; card lines pending the next plan fold; TASK-041 review checks
metadata:
  type: project
---

D-SECT39-01 confirms D-ARCH-142 with precisions. Threat model is now v1.2 (T-39, R-10, SEC-TC-15 rows; new §10.4 H). My PR56-SEC-03 `details.count` sketch is superseded.

- **Shape:** action PERMISSION_DENIED / DENIED. No new action or CHECK value. The crossing entry (count N+1) is that request's own denial entry plus `aggregated, threshold, window_seconds, window_ends_at`. The window opener (count 1) adds `suppressed_in_previous_window` (only when >= 1). `required_permission` is on every denial. `capture.denied` takes a closed typed mark, not free-form details.
- **Keys:** `rl:authz-denial:{org|system}:{actorId | credential kind}` and `rl:authz-denial-carry:...` (TTL 24 h). One atomic script: INCR; on 1, PEXPIRE + GETDEL carry; above N+1, INCR carry. The carry is restored if the opener's write fails.
- **Facts checked at 5145d52:** the five detail keys pass isSecretKey/isPiiKey/isOmittedKey unredacted. All 98 AUTHZ_DENIED operations already declare 429 RATE_LIMITED. No catalogued event exists for a Valkey fallback: proposed runtime event `rate_limit_store_unavailable` (api-designer change request).
- **Card gaps:** TASK-041 lacks the locks `api-platform-core` (app.ts/start-api.ts for trust proxy + seam) and `api-audit-mw` (capture.ts). D-SD-002 (c1efce3) landed mid-ruling without my lines. They wait for the next senior-developer fold.

**How to apply (TASK-041 review):** deep-equal the stored details for the three shapes. N+K denials from K IPs must leave vault/ip_hash rows for N+1 entries only. Scan Valkey keys against the grammar (no IP). PTTL 1..60000 on the first take. Restore after a failed opener write. startApi composition answers 429 at N+1. Counter label is the budget name only. `authz-denial` must not enter RateLimitClass.

**Status 2026-11-20:** implemented by TASK-041 and verified in its r1 (all items hold; see [[project-p5-task041]]). Card lines 1-8 still not folded by D-SD-003 (`77ac6d2`); the code twin's C4 carries the lock line. Residual to add at the next threat-model revision: late-reply carry loss (PR041-SEC-06).

**Process lesson:** another agent's in-flight DECISIONS edit appeared mid-session. I staged only my hunk with `git hash-object -w` + `update-index --cacheinfo` from a HEAD copy, which left their work-tree change untouched. `git pull --rebase` refuses with others' unstaged files; check `rev-list --left-right` after fetch instead.

Related: [[project-p5-pr56-task029]], [[project-p5-pr61-task028]], [[project-security-review-conventions]]
