---
name: project-p5-wave0-config-review
description: PR #3 (TASK-005 packages/config) R1-R3 2026-11-12 PASS_WITH_FOLLOW-UPS; verified guard-vs-driver facts (NODE_OPTIONS, pg, PGOPTIONS, ioredis rediss:) and what to check in TASK-003/004/006/014/040-052/167 reviews
metadata:
  type: project
---

The PR #3 review (TASK-005) is in `docs/05-quality/security/PR-0003-TASK-005-security-review.md`. IDs run PR3-SEC-01..16.
- R1 at `be468bc`.
- R2 at `875409d`, in the "Round 2" section.
- R3 at `0e48a2a`, in the "Round 3" section (appended, header untouched).

**R3 status (2026-11-12).**
- Verdict: PASS_WITH_FOLLOW-UPS, merge allowed.
- Closed: 01, 02, 04, 07, 10 (R2); 12 MEDIUM, 15 INFO (R3); 03 closed in PR scope by the ECS-metadata guard. Its items 2 (key-provider assert) and 3 (IaC `app_env`) stay binding, and the ADR-0018 §3 wording is still owed by principal-architect.
- New in R3: 16 INFO. A throwable whose `code` getter or Proxy trap throws escapes `describeFailureCause`, and its message leaves `resolveSecretRefs`. Fix: try/catch plus an own-data read of `code`. Optional, in this PR or TASK-006.
- Still open: 05, 06, 08 LOW (latent); 13 LOW and 14 LOW (latent), routed to TASK-014 by D-ORCH-007; 09 and 11 INFO.

**Facts verified 2026-11-12 on Node 24.22.3. Re-verify after upgrades.**
- **NODE_OPTIONS parsing.**
  - Node splits NODE_OPTIONS on a space only.
  - Double quotes group a token, and `\` escapes only inside quotes.
  - `_` is accepted for `-` in option names.
  - Tab, newline, NBSP, upper-case flags and `--experimental-(default-)config-file` all make Node exit 9.
- **NODE_OPTIONS timing.** `--inspect-brk` and `--inspect-wait` pause Node before the entry module runs. So no in-process guard can prevent them; only an entrypoint preflight run with NODE_OPTIONS unset (`env -u NODE_OPTIONS`) or IaC can.
- **pg.** `pg` 8.23.1 with `pg-connection-string` 2.14.1:
  - The LAST `sslmode` wins.
  - With `?host=`, the query param overrides the authority.
  - pg falls back to a `___DUMMY___` host for `@/`.
  - The fragment is ignored, as WHATWG ignores it.
  - An `encodeURI` pre-pass runs when the string has a space or a malformed `%`. With an IPv6 host this makes pg throw.
  - `PGOPTIONS` from the env applies when the URL has no `options`. `PGSSLMODE` and `PGHOST` do not override a URL.
  - `uselibpqcompat` with `verify-full` keeps verification.
- **ioredis 6.0.0.**
  - `parseURL` uses WHATWG `new URL`. If there is no `//`, it re-parses the value as `redis://<raw>`.
  - TLS is on only when the raw string `startsWith("rediss://")` (`Redis.js:707`, case-sensitive).
  - `rediss:user:pw@host` therefore runs plaintext, with the user `rediss`.
  - `?tls=` gives plain TCP.
- **Probing with no dist and no worktree access.** `git archive <sha> packages/config`, then strip types with Node 24's `module.stripTypeScriptTypes` into a scratch `build/` that has `{"type":"module"}`, with a scratch `node_modules` junction to the main checkout (`cmd //c mklink //J`).
  - Remove the junction afterwards with `cmd //c rmdir`, which removes the link only.
  - Never `rm -rf` through the junction.
  - The scratchpad is session-scoped, so the R2 and R3 probe scripts are gone in later sessions.
  - The R3 set to re-create: `transport`, `redis-wire`, `fuzz` and `misc`.
    - `fuzz`: a fast-check differential with the invariant "guard ACCEPTED ⇒ driver TLS".
    - `misc`: the ECS matrix, the error channels, permanent errors and brand credentials.
  - **Fuzz checker gotcha.** A username of `rediss` is legitimate in the `//` form. A missing userinfo makes the pg user come from the OS. Check TLS fields only.

**Why:** the follow-ups are spread over later tasks. Each later review must check them, or they never close.

**How to apply.** In these reviews, check:
- **TASK-006:** all four items (start-up composition, explicit ioredis `tls`, `O_NOFOLLOW` same-handle read, PR3-SEC-16) were verified CLOSED in PR #9 R1 on 2026-11-12. See [[project-p5-pr9-runtime-skeleton]].
- **TASK-014:**
  - an entrypoint preflight with `env -u NODE_OPTIONS` and an allow-list, which also refuses `PG*`/`PGOPTIONS` in hardened envs;
  - `--disable-sigusr1`;
  - per-service env, with the migrator and bootstrap URLs not in api/worker;
  - the `checkToolingEnv` helper (PR3-SEC-14).
- **Web wiring:** PR #4 uses `envPrefix: 'VITE_PUBLIC_'`; a bundle secret scan is still owed (TASK-022).
- **First key provider (TASK-040/045/048/052):** `localOnly` keys are refused outside local/test.
- **TASK-167:** the adapter accepts only checked secrets.
- **principal-architect:** the ADR-0018 §3 `NODE_ENV` → `APP_ENV` wording; the §4 ECS signal.
- **Optional hardening:** treat a defined-but-empty ECS metadata variable as present; add `AWS_EXECUTION_ENV=AWS_ECS_*`.

Related: [[project-p5-wave0-supply-chain]], [[project-security-review-conventions]], [[project-p3-security-conditions]], [[project-p5-wave0-db-baseline]]
