---
name: project-p5-pr9-runtime-skeleton
description: PR #9 (TASK-006 api/worker runtime skeleton) R1 PASS_W_F-U @374166d, R2 FAIL @05855b1 (ReDoS), R3 PASS_W_F-U @6331aeb (PR9-SEC-14 closed), R3b merge-only @6742bec; type-is/pg/readFileSync facts; later-task checks
metadata:
  type: project
---

The PR #9 review (TASK-006) is in `docs/05-quality/security/PR-0009-TASK-006-security-review.md`.
- **R1** at head `374166d`: PR9-SEC-01..13 (01–06 LOW, 07–13 INFO). Verdict PASS_WITH_FOLLOW-UPS.
- **R2** at head `05855b1`: verdict **FAIL**.
  - New: PR9-SEC-14 HIGH (a ReDoS that the PR9-SEC-01 fix introduced), PR9-SEC-15 LOW (npm `script-shell` / `npm_execpath`), PR9-SEC-16 INFO (`sslrootcert`).
- **R3** at head `6331aeb` (2026-11-13): **PASS_WITH_FOLLOW-UPS**.
  - **PR9-SEC-14 closed.** The grammar is the R2 remediation, there is a 256-character cap before any regex, and the check runs before `req.is`.
    - HTTP probe at n = 24/40/5,000: 415 in under 10 ms. Control at `05855b1`, n = 22: about 1.2 s with the event loop blocked.
    - Equivalence: 100k runs, 0 differences.
  - **PR9-SEC-16 closed.**
  - **New: PR9-SEC-17 INFO.** The 1 MiB bound is checked on `stat`, not on the read.
  - **New: PR10-SEC-21 LOW**, in the lane A tool (see [[project-p5-pr10-ci-lane]]).
- **R3b** at `6742bec`, the merge of `main` @ `e760368`: merge-only PASS_WITH_FOLLOW-UPS.

**Facts verified 2026-11-12/13. Re-verify after upgrades.**
- **type-is 2.1.0.** `normalizeType` uses `contentType.parse(v, {parameters:false})`, so `req.is` never validates parameters.
- **content-type 2.1.0.** A lenient hand-written parser that never throws. body-parser's `getCharset` uses it.
- **Node 24 `fs.readFileSync(path, 'utf8')`.** It goes to the native `binding.readFileUtf8`, which reads to EOF and ignores `stat` size. A size check done before the read is therefore not a bound: procfs files report size 0, and a path can be swapped in between. Bound the read through one fd.
- **ESM named imports of builtins.** They can be re-pointed for probes with `fs.x = …; syncBuiltinESMExports()`.
- **pg 8.23.1.**
  - An explicit `ssl` means `PGSSLMODE` is never read.
  - The runtime strips the URL query, and `tlsConfig` maps every TLS `sslmode` to `rejectUnauthorized: true`.
  - Since R3, config (`databaseUrlParamsGuard`, every APP_ENV) and the runtime share the list `RUNTIME_DATABASE_URL_PARAMS = {sslmode, sslrootcert, sslnegotiation}`.
- **npm 11.** `--node-options=` beats every source. `script-shell` and `npm_execpath` are still trusted (PR9-SEC-15, still on `main`).
- **Node listener defaults.** `requestTimeout` 300 s, `headersTimeout` 60 s (PR9-SEC-06 still open).

**Why:** the follow-ups are spread over later tasks, and they close only if each later review checks them. The HIGH came from a fix, so fixes that add regexes over request input must get a ReDoS probe.

**How to apply.** In these reviews, check:
- **PR9-SEC-15 has no task yet** (TASK-007 merged without it). Push for a task ID. The fix: spawn the Prisma bin with `process.execPath`, without npm, and drop the trust in `npm_execpath`.
- **TASK-010:** the Pino serializer for the third `error()` argument; `request_id` plus `client_correlation_id`.
- **TASK-014:**
  - PR9-SEC-17: a bounded read through one fd with `O_NONBLOCK` and `fstat`.
  - `sslrootcert` confinement to a CA directory.
  - The `NODE_EXTRA_CA_CERTS` allow-list, and refusing `PGOPTIONS`/`PG*`.
  - Worker image pruning.
- **TASK-016:** effective-value assertions on every new physical connection.
- **TASK-019/021:** replace the `pendingCheck` stubs. The tripwires now use the `isPendingCheck` WeakSet brand.
- **TASK-020/108:**
  - The body parser runs after the step-0 limiter, with a 30 s `requestTimeout`.
  - Every new header or body parser copies the `json-body.test.ts` pattern: an uncapped timing test, a property test, a differential against the reference language, and the cap boundary.
- **TASK-030:** shard on a server ID.
- **TASK-048/111:** CORS, Helmet (`nosniff`/CSP).

**Probe kit** (`scratchpad/review/PR-9-sec-r3/scripts/`; scratch is session-scoped):
- Build: `git archive <sha> apps/api/src apps/worker/src packages/config/src packages/shared/src tools/deps | tar -x -C <root>/src`, then `build.mjs <root>`.
- Junction: `<root>/node_modules` pointing at the worktree's `node_modules`. Create it with `fs.symlinkSync(target, link, 'junction')` and remove it with `fs.unlinkSync`.
- Probes:
  - `redos-client.mjs` / `redos-server.mjs` (the server runs in a child process);
  - `probe-redos-r3.mjs` (input families at n and 4n, plus equivalence);
  - `probe-config-r3.mjs` (config ⇔ runtime differential);
  - `probe-sslroot*-r3.mjs`;
  - `record-sim.sh` (lane A record check across merge scenarios, in a scratch `git clone --shared`).

Related: [[project-p5-wave0-config-review]], [[project-p5-wave0-db-baseline]], [[project-security-review-conventions]], [[project-p5-pr10-ci-lane]]
