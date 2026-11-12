---
name: project-p5-wave0-config-review
description: PR #3 (TASK-005 packages/config) review 2026-11-12 PASS_WITH_FOLLOW-UPS; verified guard-bypass facts (NODE_OPTIONS quoting/underscore, pg last-sslmode-wins, ioredis ?tls=) and what to check in TASK-004/006/014/040-052/167 reviews
metadata:
  type: project
---

The PR #3 review (TASK-005, head `be468bc`) is in `docs/05-quality/security/PR-0003-TASK-005-security-review.md`. IDs are PR3-SEC-01..11.
- Verdict: PASS_WITH_FOLLOW-UPS.
- 2 MEDIUM, both guard bypasses: 01 debug flags, 02 transport. Fix-forward was recommended in the PR, otherwise binding on TASK-006.
- 6 LOW, 3 INFO.

**Facts verified 2026-11-12 on Node 24.22.3. Re-verify after upgrades.**
- **NODE_OPTIONS.** Node starts the inspector for `"--inspect=…"` (double quotes are stripped) and for `--inspect_brk` / `--inspect_wait` (`_` is accepted for `-`). A regex on the raw string misses both. The robust check is `inspector.url()` plus `process.execArgv` at the process edge. `--disable-sigusr1` exists in Node 24.
- **pg.** `pg` 8.23.1 with `pg-connection-string` 2.14.1: the LAST `sslmode` query param wins. `URL.searchParams.get()` returns the first, so a guard that uses `get()` can be bypassed with a duplicate. `sslmode=no-verify` gives `rejectUnauthorized:false`.
- **ioredis.** ioredis 6.0.0 merges URL query params into its options. `rediss://…?tls=` gives `options.tls === ""`, which means plain TCP.
- **Probing.** `packages/config` dist can be probed with plain Node ESM `import()` of `dist/index.js` + `dist/testing/index.js` (createTestEnv makes runtime-random keys). This is cheap enough for a memory-constrained host.

**Why:** the follow-ups are spread over later tasks. Each later review must check them, or they never close.

**How to apply.** In these reviews, check:
- **TASK-006:**
  - start-up composes `resolveSecretRefs` + `checkResolvedSecrets`;
  - an inspector/execArgv belt is in place;
  - the timeout uses `Promise.race`;
  - ioredis is built with explicit `tls`;
  - the `file` provider is hardened (`O_NOFOLLOW`, under `/run/secrets`).
- **TASK-014:** `--disable-sigusr1`; per-service env; the migrator URL only in the migrate one-shot.
- **TASK-004 / web wiring:** a non-matching `envPrefix` + `webBuildDefine`; a bundle secret scan.
- **First key provider (TASK-040/045/048/052):** `localOnly` keys are refused outside local/test.
- **TASK-167:** the adapter accepts only checked secrets.
- **principal-architect:** ADR-0018 §3 wording (`NODE_ENV` vs `APP_ENV`); per-variable holders.

Related: [[project-p5-wave0-supply-chain]], [[project-security-review-conventions]], [[project-p3-security-conditions]]
