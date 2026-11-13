---
name: project-p5-pr20-logging
description: PR #20 (TASK-010 redacted Pino logging) R1 @dae1f96 PASS_WITH_FOLLOW-UPS; PR20-SEC-01 MEDIUM raw header forms leak refresh cookie; 02-07 LOW, 08-12 INFO; probe-confirmed logger facts; checks owed at TASK-052/055/113/020/014/214/188
metadata:
  type: project
---

The PR #20 review (TASK-010) is in `docs/05-quality/security/PR-0020-TASK-010-security-review.md`. R1 at head `dae1f96` (2026-11-13): **PASS_WITH_FOLLOW-UPS**.
- Simulated checker (main's tool @ `cdbeabf`, base `80ff2c2`): `pass` with 2 owned paths (`package-lock.json`, `tools/tsconfig.json`). Controls gave `missing`: no record, `--pr 19`, a `tools/tsconfig.json` edit after the record.
- **Closed:** PR7-SEC-03 item 3, PR9-SEC-10, PR #11 R3-m1 (i) / R3.6 TASK-010 row, SEC-TC-63.
- **Closed for TASK-010's part only:** PR6-SEC-02 item 3, PR6-SEC-03 item 1. The client halves stay with TASK-113.
- **SEC-P3-23, TASK-010 part:** partly closed (keyed forms only).

**Open findings:**
- **01 (MEDIUM).** `req`, `res`, `req.socket`, `req.rawHeaders` and `Object.entries(req.headers)` are walked as plain data. They leak the `__Host-rt_*` refresh cookie, `X-Reauth-Proof`, `X-Quote-Token`, `X-Api-Key` and the query (`req._parsedUrl.path`/`_raw`).
  - In free text, a `Cookie:` value ends at the first `;`, so only the first cookie is redacted.
  - `AUTH_SCHEME` knows only bearer and basic.
- **LOW:**
  - 02: no PII-key filter on general lines; secret-key gaps (`pass`, `pwd`, `sid`, `session`, `jwt`, `dsn`, `connectionString`, nested `card.number`);
  - 03: URL queries, `*Url` keys, URI userinfo with a dotless host, `%40` e-mails;
  - 04: `APP_LOG_LEVEL=error` drops 22 of 27 security events; runtime integrity events default to warn;
  - 05: security-event PII deny-list is narrow (`username`, `client_ip`, `tenant_id` pass; the `*count` exemption also exempts `*account`);
  - 06: no `uncaughtException`/`unhandledRejection` handlers, so Node's default stderr prints Prisma text;
  - 07: no per-line budget (about 16 MiB / 4.5 s worst; about 0.4 ms per KiB).
- **INFO 08–12:** C1/U+2028 raw; `security.*` forgeable at any level; bound/Proxy stack getters accepted as native; outbound `correlation_id` is reserved, so it is dropped; the server-only subpath is not lint-enforced; Joi `with value` and escaped-quote pairs.

**Facts (probe-confirmed 2026-11-13; re-verify after changes):**
- **Database errors.** The serializer gives `{ name, code, originalCode, kind }` for the real Prisma 7.10 classes, `DriverAdapterError` and pg `DatabaseError`, also as a `cause` and as a field value.
- **Problem handler** logs `thrown` only at status ≥ 500, so 4xx bodies and Joi messages are not logged today.
- **Config secrets** are `Secret` objects with private fields, so the walker writes `{}`.
- **Pino 10** JSON-escapes all C0 controls; `%s` in the message is not interpolated.
- **V8 fixes the stack header at the first `.stack` read**, so a later `err.message = …` does not scrub it.
- **TASK-113's sheet names `packages/shared/src/security-events.ts`**, but the catalogue landed at `packages/shared/src/logging/security-event.ts`.

**Why:** the logger is the last control for the "secrets/PII in logs = 0" guardrail, and its gaps close only if later reviews check them.

**How to apply.** If the PR #20 fix cycle takes them, verify:
- 01: the stream/EventEmitter guard, the `walkArray` pair rule, cookie value to end of line, an extended SEC-TC-31 with `{req}`, `{res}`, `{socket}`, `{rawHeaders}`;
- 02 key lists;
- 04 items 1 and 3;
- 06.

Otherwise check at:
- **TASK-052/055** (first refresh cookie; due date for 01);
- **TASK-113:** 05, 10, plus the PR6 client halves;
- **TASK-020:** 07, 12 (Joi messages without `{#value}`);
- **TASK-014:** 04 item 2 (clamp `APP_LOG_LEVEL` in hardened envs);
- **TASK-214:** 06 and the leak metric;
- **TASK-188/135/139/140:** feed the per-carrier sensitive-field lists into the logger;
- **TASK-022:** 11.

**Probe kit** (`scratchpad/review/PR-20-sec/scripts/`; scratch is session-scoped):
- `build.mjs <root>` strips `git archive` sources into `build/`, rewriting `@platform/shared/logging` to relative paths.
- Junction `build/node_modules` → the worktree's `node_modules`. Remove it with `fs.unlinkSync`.
- Probes:
  - `probe-redaction.mjs` (corpus);
  - `probe-req.mjs` (live Express request);
  - `probe-inject.mjs`;
  - `probe-lines.mjs`;
  - `probe-db.mjs` (real Prisma classes);
  - `probe-redos.mjs`;
  - `probe-uncaught.mjs`;
  - `probe-misc.mjs`;
  - `probe-pii.mjs`.

Related: [[project-p5-wave0-carrier-docs]], [[project-p5-wave0-rls-spike]], [[project-p5-pr9-runtime-skeleton]], [[project-p5-pr11-rls-review]], [[project-p3-security-conditions]], [[project-p5-pr10-ci-lane]], [[project-security-review-conventions]]
