---
name: project-p5-pr42-audit-writer
description: PR #42 (TASK-025 audit writer, admission bulkhead, audit lock_timeout) R1 @e7dfbac 2026-11-14 PASS_WITH_FOLLOW-UPS; PR42-SEC-01 MEDIUM shared anonymous admission key, 02 MEDIUM rollback relies on rethrow; LOW 03-07 and 12, INFO 08-11; code review R1-M1 forces a fix cycle and round 2; #39 overlap; union-with-#40 rule; checks owed TASK-028/029/030/033/047/052
metadata:
  type: project
---

Record: `docs/05-quality/security/PR-0042-TASK-025-security-review.md`, written into the PR worktree `Shipqube-TASK-025` (uncommitted, LF, 522 lines). Code review twin landed on main mid-round (`474a827`, CHANGES_REQUESTED): R1-M1 = my 06, R1-m1 = 05, R1-m2 = 03, R1-m3 = my new 12 (lone surrogate -> client 500 feeding ROLLBACK_TRIGGERS); their R1-n10 = my 01 (they NIT, I MEDIUM); their R1-n3 claim "field logged via toJSON" is wrong for the platform serializer (never calls toJSON). R1-M1 forces a fix cycle, so round 2 = delta + union record on the final head.

**R1 @e7dfbac: PASS_WITH_FOLLOW-UPS.** 31 owned paths (packages/audit 16, platform/db 9, platform/audit 1, prisma/tests/audit 1, eslint, lock, prisma/package.json, tools/tsconfig). NOT owned: `packages/config/src/{schema,guards}.ts` (bulkhead/audit-lock bounds live there), error catalogue, `.env.example`.
- **01 MEDIUM** (principal-architect, before TASK-052): every `orgId ''` tx shares key `anonymous` (sign-in, guest, public). Probe: cap 5/queue 10, 15 attacker loops -> 97/97 legit anonymous refused, tenants fine. Fix: anonymous classes (`auth` reserve, `guest:<hash>`, `public`) + global ceiling; threat-model T-xx + SEC-TC owed by me.
- **02 MEDIUM** (fix cycle or before TASK-029): pre-SQL refusals (INVALID_ENTRY, TOKENISER_*, HEAD_MOVED) leave the PG tx healthy; a swallowing caller commits without the entry. Fix: `AuditSqlPort.markRollbackOnly` + check in `withTenantTx` after `fn`.
- **LOW (6):** 12 lone surrogate -> client-controllable 500 (fix: `toWellFormed()` in the snapshot + 400 for NUL/surrogates at the boundary); 03 TOCTOU (`complete()` re-reads caller objects after the tokenise await: DENIED-only bypass, forged `$pii` stored); 04 `route`/`entity_id`/`ua_parsed`/JSON keys accept PII; 05 setter pin evadable (`set_config (`, `SET_CONFIG(`, `"set_config"(` with computed key pass lint+pin); 06 `createPrismaAuditStore`/`prepareEntry` not in `writerExports`; 07 `AuditSqlPort` not in `TENANT_TX_HANDLE_TYPES` (tokeniser not a T-83 root).
- **INFO:** 08 config extremes (cap = pool allowed; audit lock up to 59,999); 09 hash under lock 5.4 ms at 2x1 MB; 10 HEAD_MOVED no security event, kind dropped when a cause exists; 11 column parity is a count, cross-stream write, orphan entry after HEAD_MOVED.
- SEC-P3-17 closed at writer layer (randomInt(16), 16/16 shards with fixed correlation id).

**Facts (probe-confirmed 2026-11-14):** a data-modifying CTE always runs, so `HEAD_MOVED` leaves the inserted entry in the tx; no unique `(stream_id, stream_seq)` possible on the partitioned table. Lock leaf: `packages["prisma"].devDependencies["@platform/audit"]`; ajv 8.20.0; 15 `link:true`, all @platform. Lane A 43549201001 all green except the record step. Evidence `20261114T0246Z_ab8fea1` host scan 0.

**Union rule:** PR #40 @ee64946 shares no path with #42, so a pure main merge keeps the R1 record valid (sim S5 pass); any merge or fix touching #42's 46 paths needs a round-2 against record §7 (S5b missing). PR #39 (TASK-014) DOES overlap: owned `with-tenant-tx.ts` + `packages/config/src/{guards,index,load-config.test,values.test}.ts`; second merger keeps #39's `TenantTxConfigError(msg, variable)` with `DB_TENANT_*` names, `databaseGuard` in GUARDS (`GUARDS.length === 15`), union of config index exports. The `refs/remotes/origin/pr40` ref vanished mid-round (another agent pruned): use SHAs in sims, objects stay reachable via the shared clone's alternates.

**Probe kit** (session scratch `review/PR-42-sec/probes/`): `mknm.mjs` (junction node_modules, @platform -> extract), `hooks.mjs`, `lintprobe.mjs`, `lint-t83.mjs`, `p-entry.mjs`, `p-admission*.mjs`, `p-freetext.mjs`, `p-hashcost.mjs`, `hostscan.mjs`, `gl-emul.mjs` (+ `gitleaks-v8.30.1.toml`), `record-sim.sh` (11 scenarios incl. #40 squash union).

**How to apply:** TASK-029 review: 02/03/04/06/11(b) and writer wired from config; TASK-028: 07, no values in error messages, no PII keys; TASK-030: SEC-TC-57, 05 pin kept, 09, 10, 11(a); TASK-033: per-role audit DML, 11(b)(c); TASK-052: 01 implemented; TASK-047: worker anonymous class + latch.

Related: [[project-p5-pr24-audit-store]], [[project-p5-pr27-spk04-spike]], [[project-p5-pr40-covhook]], [[project-p5-pr32-route-pipeline]], [[project-p5-pr20-logging]], [[project-security-review-conventions]]
