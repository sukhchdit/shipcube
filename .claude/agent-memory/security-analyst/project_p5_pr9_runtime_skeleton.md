---
name: project-p5-pr9-runtime-skeleton
description: PR #9 (TASK-006 api/worker runtime skeleton) R1 PASS_WITH_FOLLOW-UPS @374166d, R2 FAIL @05855b1 (PR9-SEC-14 HIGH ReDoS in charset regex); type-is/content-type/npm/pg facts; R3 and later-task checks
metadata:
  type: project
---

The PR #9 review (TASK-006) is in `docs/05-quality/security/PR-0009-TASK-006-security-review.md`.
- **R1** at head `374166d`: PR9-SEC-01..13 (01–06 LOW, 07–13 INFO). Verdict PASS_WITH_FOLLOW-UPS.
- **R2** at head `05855b1` (2026-11-13): verdict **FAIL**.
  - New: **PR9-SEC-14 HIGH**, a ReDoS that the PR9-SEC-01 fix introduced; PR9-SEC-15 LOW (npm `script-shell` / `npm_execpath` residual); PR9-SEC-16 INFO (`sslrootcert` path not confined).
  - Closed: 01 (as a smuggling control), 02 items 1–2, 04 items 1/2/4, 05, 07, 08, 11. 09 is partial (problems are now `no-store`).

**R3 checks (PR9-SEC-14).**
- The fix: `json-body.ts` `MEDIA_TYPE` becomes `(?:[ \t]*;(?:[ \t]*T=(T|Q))?)*`, so the whitespace after `;` sits inside the optional parameter. Plus a `Content-Type` length cap of 256.
- Tests: a unit timing test (`'; '.repeat(5000)+'!'` under 50 ms) and an API test (n=40 → 415 at once).
- Re-run `probe-charset-r2.mjs`, `redos-client.mjs` (the server runs in a child process, otherwise the timings lie) and `probe-redos.mjs` (equivalence: 50k runs, 0 differ).

**Facts verified 2026-11-12/13. Re-verify after upgrades.**
- **type-is 2.1.0.** `normalizeType` uses `contentType.parse(v, {parameters:false})`, so `req.is` never validates parameters. Any `Content-Type` tail reaches app code.
- **content-type 2.1.0.** A lenient hand-written parser: it never throws, keeps the first value of a repeated key, and allows OWS around `=`. body-parser's `getCharset` uses it (`read.js:263`).
- **body-parser 2.4.0 JSON.** It accepts any `utf-*` charset. Since R2, the app refuses everything except UTF-8 (differential: 20k runs, 0 smuggles).
- **npm 11.** `--node-options=` beats env (any case), project, user and global npmrc (7 sources proven). `npm exec` still runs the bin through `script-shell` taken from npmrc or env. `tools/deps/npm-cli.mjs` trusts `npm_execpath`.
- **pg 8.23.1.** `upgradeToSSL` passes `host` (IP SAN check) and sets `servername` only for DNS names. An explicit `ssl` means `PGSSLMODE` is never read. The head strips the URL query, so `rejectUnauthorized:true` survives `NODE_TLS_REJECT_UNAUTHORIZED=0`. pg-connection-string 2.14.1 URL keys REPLACE an explicit `ssl`, which is why the query is stripped.
- **finalhandler 2.1.1.** It sends the stack as HTML unless `NODE_ENV=production`. The problem handler now has a try/catch fallback.
- **Express 5.** `trust proxy` false; query parser `simple`. Node listener defaults: `requestTimeout` 300 s, `headersTimeout` 60 s (PR9-SEC-06 is still open).
- **ECS (PD-05).** It polls `/health/live` only. The integrity monitor timer (5 min, unref'd) now covers detection.

**Why:** the follow-ups are spread over later tasks, and they close only if each later review checks them. The HIGH came from a fix, so fixes that add regexes over request input must get a ReDoS probe.

**How to apply.** In these reviews, check:
- **TASK-007 / tools-deps:** PR9-SEC-15 (spawn the Prisma bin with `process.execPath` and no npm; drop the `npm_execpath` trust).
- **TASK-010:** the Pino serializer for the third `error()` argument; `request_id` plus `client_correlation_id`.
- **TASK-014:**
  - The preflight refuses `PGOPTIONS`/`PG*` and a non-allow-listed `NODE_EXTRA_CA_CERTS`.
  - Optionally, `sslrootcert` confinement.
  - Worker image pruning; local holders strict.
- **TASK-016:** effective-value assertions on every new physical connection. This also covers a transient `ALTER ROLE SET … RESET` between monitor ticks.
- **TASK-019/021:** replace the `pendingCheck` stubs (the tripwire tests enforce it).
- **TASK-020/108:**
  - The body parser runs after the step-0 limiter; 30 s `requestTimeout`.
  - Any header or body parser needs a linear grammar, a length cap and a timing test.
- **TASK-030:** shard on a server ID.
- **TASK-048/111:** CORS, Helmet (`nosniff`/CSP).

**Probe kit** (`scratchpad/review/PR-9-sec-r2/scripts/`; scratch is session-scoped, so rebuild it from this note):
- `git archive <sha> apps/api/src apps/worker/src packages/config/src packages/shared/src tools/deps | tar -x`, then run `build.mjs <root>`. It type-strips and rewrites `@platform/*` to the stripped paths.
- Junction: `node -e "fs.symlinkSync(target, link, 'junction')"`. `cmd //c mklink /J` breaks in Git Bash. Remove it with `fs.unlinkSync`.
- **Fake PostgreSQL server for TLS-option capture.** It must answer `S` alone: pg compares the response byte exactly. Break the handshake after the ClientHello.
- **Do not stub `tls.connect` with a never-connected socket.** pg then hangs, and the hang is an artefact, not a finding.

Related: [[project-p5-wave0-config-review]], [[project-p5-wave0-db-baseline]], [[project-p5-wave0-rls-spike]], [[project-security-review-conventions]], [[project-p5-pr10-ci-lane]]
