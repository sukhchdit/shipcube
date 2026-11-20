---
name: project-p5-task041
description: TASK-041 (Valkey rate limiting, trust proxy, T-39 denial budget) r1 @e6f484a (d52a340) + r2 delta @3a6b4c8b (343f9dc3, D-SECPR041-02) PASS_W_F-U, record PR-pending on main (rename needed); 01/02a/05/08 closed; new LOW 09 authn-failed lock scope; QG-041-C4 concurrence E1-E5; 041-B round and threat-model alignment owed
metadata:
  type: project
---

Round 1, 2026-11-20, pre-push (no PR number). Record `docs/05-quality/security/PR-pending-TASK-041-security-review.md` and D-SECPR041-01 are on **main** `d52a340` (pushed). Head row `e6f484a` (full SHA), merge base `29fe2a1`, 19 owned paths. Code twin APPROVED_WITH_NITS (`7d24349`, R1-m1..m8, its C1 = architect ruling on R1-m1 + ADR-0016 §8/am. 1 amendment).

**Findings:**
- **01 LOW (= R1-m5):** `createMemoryStore`/`memoryDenialStore` scan all entries per new key at 50k: 1.2-1.6 ms vs 0.013 ms. Fix validated (bounded 64-entry sweep + evict `windows.keys().next()` + delete/re-insert on reopen). Due before TASK-049.
- **02 LOW (= R1-m1/S1):** `presentsCredential` (presence) picks step0:credentialed 6,000/min vs 120. Rec (a) non-module paths anonymous now; (b) `rl:step0:authn-failed:<ip>` budget hit by authn slot, checked at step 0, before TASK-052 (MEDIUM if open then).
- INFO 03 fail-open relies on ADR-0010 carrier admission (must not fail open); 04 per-/64 keyspace under noeviction (OI-15); 05 TRUST_PROXY_HOPS default 1 fails silently toward spoofing (prefer 0; IaC pin 2 + sg-alb prefix list + X-Origin-Verify); 06 late Valkey reply loses GETDEL'd carry (residual, add to threat model §10.4 H — my action); 07 IPs in Valkey keys + 7-day snapshots (data inventory); 08 live createApp without `rateLimit` not refused.

**Facts:** moduleRegistry empty at e6f484a (only health routes); express-rate-limit 8.7.3 `ipKeyGenerator` unmaps isMapped4 and IPv4-compatible; Valkey cluster mode disabled (no CROSSSLOT); ACL api `~rl:* +@all -@dangerous`; Express trust proxy N: hops>chain = spoof, hops<chain = shared proxy bucket.

**How to apply (round 2 / delta):** re-run the kit in session scratch `t041/probes/` (hooks.mjs, p1 trust matrix, p2 mapped spellings 120k, p4 prune cost, p5 budget edge cases, p6 ReDoS, sim.mjs args `<clone> <record> <main> <base 29fe2a1> <head>`, gl-over/gl-generic). Delta round needed if owned paths, app.ts, start-api.ts or schema.ts change (checker voids only owned). Orchestrator must rename the record before the event (C2).

**Round 2 (2026-11-20, delta, part 041-A) @3a6b4c8b, PASS_W_F-U, D-SECPR041-02, appended on main `343f9dc3`:** base now 6ab40f28, 27 owned paths (adds package.json, lockfile, config guards.ts). Closed 01, 02(a), 05 (code), 08. QG-041-C4 first half: concur items 2,3,5,6,9; item 4 `exp` pre-check concurred with E1-E5 (TASK-052 tests: 0 verifies for past-exp forgeries). **New PR041-SEC-09 LOW:** the authn-failed lock refuses every credentialed request of the IP; `__Host-rt_web` is Path=/ same host, so returning browsers' sign-in is locked too; my r1 "NAT neighbours unaffected" was wrong. Rec R1 (cookie counts only on refresh-cookie route paths) + R2(i) (record true scope, pin valid-bearer-429 row, alert). Facts: ES256 jose verify ~400 µs here vs 4.6 µs exp pre-check; `resolveApiMode` live = production only. `.env.example` + evidence (docs/05-quality/tests/runs/) commits keep the binding (sim S2). **041-B round:** items 4 (+09, E1-E5), 7 breaker, 8 fallback set (closes 03 HTTP side); before TASK-052 dispatch. **Mine before G3:** threat model R-13/T-11/T-39/T-93 vs ADR-0016 am. 12 + PR041-SEC-06.

Related: [[project-t39-denial-budget-ruling]], [[project-p5-pr61-task028]], [[project-p5-pr56-task029]], [[project-security-review-conventions]]
