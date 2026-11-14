---
name: project-p5-pr44-020c
description: PR #44 (TASK-020 part 020-C, route I/O phases, credential headers, T-83 residuals, D-ARCH-114) R1 @9def3f5 2026-11-14 PASS_WITH_FOLLOW-UPS; PR44-SEC-01 MEDIUM aliased createRequire escapes import controls; LOW 02-05, INFO 06-09; closures PR38-SEC-02(static)/03/04, PR32-SEC-12; delta-round checklist
metadata:
  type: project
---

Record: `docs/05-quality/security/PR-0044-TASK-020C-security-review.md`, written into worktree `Shipqube-TASK-020` (uncommitted, LF, ~490 lines). R1 head `9def3f594bae2f8e340e779ed14e1f7c722df088`, merge base `2634a76`, 42 owned paths (checker). Code review twin on main `aae9ded`: CHANGES_REQUESTED (R1-M1 deadline not enforced, R1-m1..m6), so a fix cycle + security delta round follow.

**Verdict PASS_WITH_FOLLOW-UPS** (1 MEDIUM pre-existing, 4 LOW, 4 INFO; no regression).
- **Closed:** PR38-SEC-03 (224-cell header matrix: 216 refused, 8 = x-quote-token on `session`/`[session]`; projection reads same `describe().keys`, 0/8 accepted shapes deliver), PR38-SEC-04 (non-plain `$_terms` reported; D-TASK020-56 accepted, not a bypass), PR38-SEC-02 static forms (18 rows newly refused vs main), PR32-SEC-12, PR #38 R2-n1.
- **01 MEDIUM** (= code review R1-m6, they rated MINOR): `const req = createRequire(u); req(x)`, `import {createRequire as mk}`, `m.createRequire(u)(x)` are seen only by static-module-specifier/system-model-owner. boundaries' additional-dependency-node matches the inline form only; moduleSourceVisitor only bare `require`; prisma-client-construction constructs by name (`new C()` alias escapes) and is OFF in platform/db. From un-owned module code: generated client, `pg`, adapter, audit writer load lint-clean. Fix: confine createRequire to `.resolve(<literal>)` in apps/packages src. Due: fix cycle or 020-D, before first module/worker-job code PR.
- **02 LOW** (= R1-m1 + R1-M1): `close` listener registered lazily at first `signal()` → disconnect during load missed (probe A); deadline advisory.
- **03 LOW** (= R1-m4): afterCommit queue uncapped (200k items +226 MiB). Before first afterCommit route (createQuote fan-out).
- **04 LOW** (⊇ R1-m5): T-83 silent shapes: spread phases, `` [`load`] ``/`[K]` keys, `defineRoute.call`, const alias of factory, `(0,defineRoute)`, `??`; sources: `node:timers` setTimeout, `global.setTimeout`, timers/promises setInterval, http2/net/dns/child_process/global WebSocket (last five also escape outbound-http-via-client SSRF rule).
- **05 LOW** pre-existing: tagged raw `COMMIT`/`ROLLBACK`/session `SET`/`RESET ALL` not refused by db-raw-sql (only `SET LOCAL` text) or TenantDb guard → ends read-only load / handler tx; reasoning only (no Docker). 020-D with D-ARCH-124.
- **INFO:** 06 extension walk misses `_rules` args (`array.has(ext)`, `object.assert(path, ext)`; `.custom()` accepted anyway), 07 x-quote-token reaches call/afterCommit, 08 ratchet `tools/repo/test-lane-idle-timeout.test.ts` + `tests/generated/route-metadata*` unowned, 09 `node:vm`/`data:` import/Worker eval lint-clean.

**Facts (probe-confirmed 2026-11-14):** PG 16+ refuses `RESET transaction_read_only` (GUC_NO_RESET, commit 3853664); `SET TRANSACTION READ WRITE` after first query = 25001. `outbound-http-via-client` covers fetch/http(s)/client libs only. Semgrep password-hashing.yml matches aliased `$R("bcrypt")` (only alias-aware import control). Lane A check-evidence: e43ccff accepted, 79b9616 rejected stale (EPIC-03 story file); main's post-#40 verifier agrees. `main.ts` sets no server response timeout.

**Kit (session scratch `pr44sec/`):** `lintprobe.mjs` (lintText, cwd = worktree or main checkout, prints ruleIds), `cases-l.mjs` (103), `cases-t.mjs` (55), `cases-t2.mjs` (38, queue + sleep sources so outbound rule cannot mask), `p-define.mjs` (header matrix, shapes through real `declaredHeaders` via a scratch copy of validate.ts with appended export, walk, phases), `p-signal.mjs` (executeSlot + Express + raw socket), `p-queue.mjs`, `hostscan.mjs`, `record-sim.sh` (15 scenarios + current main check-evidence; `tar -x < file`, not `-f C:/...`). Git Bash: `git show "origin/main:path"` needs MSYS_NO_PATHCONV=1.

**How to apply (delta round):** re-run P1/P2/P4/P5 on new head vs 9def3f5 as control; check 01 fix closes F08-F11/F16/F17/A04-A06/A11-A13 while A18 `.resolve` stays clean; fresh lane-B evidence; record sim. Union with #42 (with-tenant-tx readOnly line inside admission-wrapped closure; route-phases.int 5/5 in evidence; stand-in reason → TENANT_CONCURRENCY_LIMIT) or #43 (cross-tenant.int idle 15000 → TEST_LANE constant) voids the record (sim S9/S10) → merge-only/delta round.

Related: [[project-p5-pr38-020b]], [[project-p5-pr32-route-pipeline]], [[project-p5-pr42-audit-writer]], [[project-p5-pr43-task024-rls-generator]], [[project-security-review-conventions]]
