---
name: d-arch-088-audit-ab-method
description: SPK-04 FALLBACK (2026-11-13) wording amendment to NFR-AUDIT-005 / NFR-PERF-001 methods and A-029 re-baseline (150 req/s on shared Windows host); NFR.md v1.6; FULL-conditional convention
metadata:
  type: project
---

NFR-AUDIT-005 method is now the k6 `audit-ab` A/B against the **build-time `-bench` image** (ADR-0007 am. 4, never a runtime flag) on the NFR-PERF-001 mix with a 20% hot-tenant share, per-repetition deltas, §7.10 validity rule (dropped_iterations ≤ 1%, CPU ≤ 85% in ≥ 90% of samples), ≥ 2 reps, randomised arm order. "This run" column = "FULL (conditional on TASK-280 valid 300 req/s run before G3; otherwise PARTIAL)". NFR.md bumped to v1.6 (D-ORCH-031 / D-ARCH-088, product-manager co-decider); counts unchanged 91 NFRs, 75/10/6.

A-029 re-baselined 2026-11-13: shared Windows 11 / Docker Desktop host (i9-11950H, 16 logical CPUs, 32 GB) sustains the audit-on mix cleanly at 150 req/s, not 300. TASK-280 (T-QA-06) owns the clean 300 req/s run on a quiet/native-Linux host, due before G3.

**Why:** SPK-04 (TASK-018, PR #27) returned FALLBACK — hot-tenant advisory-lock queueing saturated the host; runs INCONCLUSIVE under TEST-STRATEGY §7.10. The old wording ("feature-flagged benchmark baseline", single p95 delta) was unverifiable and contradicted the ADR.

**How to apply:** If TASK-280 fails or slips past G3, flip NFR-AUDIT-005 "This run" to PARTIAL **and** add a row to NFR.md §"Partially verifiable this run" (that is a status/count change → needs a D-entry, not a wording amendment). The §9 partial table and "Reasons for non-FULL" paragraph were deliberately NOT touched in v1.6 to keep 75/10/6. Any further NFR-PERF-001 / NFR-AUDIT-005 / A-029 / A-036 edit should move together. See [[d059-batch3-alignment]] for the wording-amendment convention.
