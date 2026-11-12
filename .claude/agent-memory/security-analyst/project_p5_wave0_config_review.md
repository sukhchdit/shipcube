---
name: project-p5-wave0-config-review
description: PR #3 (TASK-005 packages/config) R1+R2 2026-11-12 PASS_WITH_FOLLOW-UPS; verified guard-vs-driver facts (NODE_OPTIONS, pg, ioredis opaque rediss:, -brk/-wait) and what to check in TASK-003/004/006/014/040-052/167 reviews
metadata:
  type: project
---

The PR #3 review (TASK-005) is in `docs/05-quality/security/PR-0003-TASK-005-security-review.md`. IDs run PR3-SEC-01..15.
- R1 at `be468bc`.
- R2 at `875409d`, in the "Round 2" section.

**R2 status.**
- Verdict: PASS_WITH_FOLLOW-UPS.
- Closed: 01, 02, 04, 07, 10.
- Open:
  - 03 LOW: the PR added only the converse `nodeEnvGuard`. `APP_ENV=local` + `NODE_ENV=production` + local-only keys still loads.
  - 12 MEDIUM (new): opaque `rediss:` URL, no `//`.
  - 13 LOW (new): the debug guard cannot prevent `--inspect-brk` / `--inspect-wait`.
  - 14 LOW (new, latent): tooling URLs are validated nowhere.
  - 15 INFO (new): `constructor.name` leak channel.
  - 05, 06, 08 LOW (latent).
  - 09, 11 INFO.

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
  - pg falls back to a `___DUMMY___` host for `@/`; Joi `uri()` rejects that form.
  - `uselibpqcompat` with `verify-full` keeps verification.
- **ioredis 6.0.0.**
  - TLS is on only when the raw string `startsWith("rediss://")` (`Redis.js:707`, case-sensitive).
  - `rediss:user:pw@host` (no `//`) passes a WHATWG `protocol === 'rediss:'` check, but ioredis sends the password in plaintext RESP. Verified by a loopback capture.
  - `?tls=` gives plain TCP.
- **Probing with no dist and no worktree access.** `git archive <sha> packages/config`, then strip types with Node 24's `module.stripTypeScriptTypes`, with a scratch `node_modules` junction to the main checkout (`cmd //c mklink //J`).
  - Remove the junction afterwards with `cmd //c rmdir`, which removes the link only.
  - Never `rm -rf` through the junction.

**Why:** the follow-ups are spread over later tasks. Each later review must check them, or they never close.

**How to apply.** In these reviews, check:
- **TASK-006:**
  - start-up composes `resolveSecretRefs` + `checkResolvedSecrets`;
  - ioredis is built with explicit `tls` (this also covers PR3-SEC-12 if the PR does not fix it);
  - the `file` provider opens with `O_NOFOLLOW` and does `fstat` plus a bounded read on the same handle, with a mode check.
- **TASK-014:**
  - an entrypoint preflight with `env -u NODE_OPTIONS` and an allow-list;
  - `--disable-sigusr1`;
  - per-service env, with the migrator and bootstrap URLs not in api/worker (`compose.env` now carries `DATABASE_BOOTSTRAP_URL`).
- **TASK-003 / migrate one-shot:** `prisma.config.ts` calls a tooling-env check (TLS + placeholder) — PR3-SEC-14.
- **Web wiring:** PR #4 uses `envPrefix: 'VITE_PUBLIC_'`; a bundle secret scan is still owed (TASK-022).
- **First key provider (TASK-040/045/048/052):** `localOnly` keys are refused outside local/test.
- **TASK-167:** the adapter accepts only checked secrets.
- **principal-architect:** PR3-SEC-03 option (b), the ECS-metadata signal, recommended; per-variable holders.

Related: [[project-p5-wave0-supply-chain]], [[project-security-review-conventions]], [[project-p3-security-conditions]], [[project-p5-wave0-db-baseline]]
