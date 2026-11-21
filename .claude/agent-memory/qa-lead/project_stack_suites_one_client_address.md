---
name: stack-suites-one-client-address
description: Every Compose/e2e/k6 suite hits the API from one address, so per-IP limits, the failed-auth budget and the in-flight room are shared by the whole run; triage 429s in stack runs as test-design defects first
metadata:
  type: project
---

Since D-QA-023 (2026-11-21, TEST-STRATEGY 1.6 §10.4, answering QG-041B-C7 (c)), every suite run against the Compose stack shares one client address (edge, `TRUST_PROXY_HOPS=1`). One refused-credential test spends the 120/min failed-auth budget for every worker (429 up to 60 s). The in-flight room (120 minus that minute's failures, one per API instance, `Retry-After: 1`) is also shared, and so are the per-IP class limits (`auth` 10/min, guest quotes 100/h). §15 item 25 = A-112 validation: no `step0-authn-inflight` refusal in the gate e2e run outside the provoking tests.

**Why:** the product keys limits by IP on purpose, so the stack cannot give workers their own addresses without forging XFF. It is not measured whether a gate e2e minute fits the 120 anonymous default (rule 5 allows a recorded raise).

**How to apply:** in P5/P6 regression triage, a 429 in an e2e/stack run is first a test-design defect against §10.4 rules 3 to 6 (e2e-test-engineer, TASK-279), not a product defect. A `Retry-After: 1` on a credentialed request outside a provoking test fails item 25. In-process suites must keep a fresh limiter per harness. Related: [[suite-activation-required-cases]]
