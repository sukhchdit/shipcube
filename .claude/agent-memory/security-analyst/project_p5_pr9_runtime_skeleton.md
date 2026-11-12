---
name: project-p5-pr9-runtime-skeleton
description: PR #9 (TASK-006 api/worker runtime skeleton) R1 2026-11-12 PASS_WITH_FOLLOW-UPS; verified npm node-options, body-parser UTF-7, pg ssl override, finalhandler facts; checks owed by TASK-007/010/014/016/019/020/021/030/108/111
metadata:
  type: project
---

The PR #9 review (TASK-006) is in `docs/05-quality/security/PR-0009-TASK-006-security-review.md`. R1 is at head `374166d` (merge-base `7712c7c`). IDs run PR9-SEC-01..13: 01–06 LOW, 07–13 INFO. Verdict PASS_WITH_FOLLOW-UPS.

**Routed items.**
- Closed: PR3-SEC-05, 06, 07 (residual), 16; PR3-SEC-02/-12 (consumer half); PR5-SEC-08 (fuzz 20k runs, 0 violations); PR7-SEC-02 item 2; PR7-SEC-03 items 2 and 4; PR7-SEC-06 item 3.
- **Partial:** PR5-SEC-07, bypassed by npm `node-options` (PR9-SEC-02).
- Still open: PR7-SEC-02 item 3 (`PGOPTIONS`), tracked as PR9-SEC-03.

**Facts verified 2026-11-12. Re-verify after upgrades.**
- **npm 11 `node-options`.**
  - `@npmcli/config` `set-envs.js:102` writes `node-options` into `NODE_OPTIONS` for the commands `npm exec` and `npm run` start.
  - Sources: `npm_config_node_options` (any case), or a project, user or global `.npmrc`.
  - So dropping `NODE_OPTIONS` before spawning npm does nothing.
  - Fix: `npm exec --node-options= …`, which neutralises every layer, or spawn the bin directly.
- **body-parser 2.4.0 JSON.**
  - It accepts any charset that starts with `utf-` (`json.js:56`), so UTF-7 and UTF-16 decode.
  - UTF-7 `+ACI-` smuggles keys and `+ADw-` smuggles markup past byte-level inspection or a WAF.
  - The limit applies after inflation: a gzip bomb gives 413.
- **pg-connection-string 2.14.1.** `sslmode=verify-full` gives `ssl: {}`, and URL keys REPLACE an explicit `ssl` config. So `NODE_TLS_REJECT_UNAUTHORIZED=0` turns off verification, and only an environment guard (or building pg config without `connectionString`) can pin it.
- **finalhandler 2.1.1.** It sends `err.stack` as HTML unless `NODE_ENV=production`. The config guard forces production `NODE_ENV` only in staging and production.
- **Express 5.** `trust proxy` defaults to false, and the query parser is `simple`. The automatic `OPTIONS` reply is 200 with `Allow` and no ACAO.
- **Node listener defaults.** `requestTimeout` 300 s, `headersTimeout` 60 s.
- **ECS polling (platform PD-05).** ECS health checks and ALB target health use `/health/live`. `/health/ready` is polled only by the deployment step controller and dashboards. Any readiness-driven detection therefore needs its own timer.

**Why:** the follow-ups are spread over later tasks, and they close only if each later review checks them.

**How to apply.** In these reviews, check:
- **TASK-007:** `--node-options=` on the `tools/deps` npm calls.
- **TASK-010:** the Pino serializer for the third `error()` argument; `request_id` plus `client_correlation_id`.
- **TASK-014:** the preflight refuses `PGOPTIONS`, `PG*`, `NODE_TLS_REJECT_UNAUTHORIZED` and a non-allow-listed `NODE_EXTRA_CA_CERTS`; worker image pruning (the worker now depends on `@platform/api`); local holders strict.
- **TASK-016:** the factory refuses `PGOPTIONS`; effective-value assertions on the start-up probe.
- **TASK-019/021:** replace the `pendingCheck` stubs (audit should report `degraded`, not `ok`).
- **TASK-020/108:** body parser after the step-0 limiter; 30 s `requestTimeout`; charset UTF-8 only.
- **TASK-030:** shard on a server ID.
- **TASK-048/111:** CORS and Helmet.
- **If a PR #9 fix cycle comes back as R2:** verify 01 (charset), 04 item 1 (Valkey `rejectUnauthorized`), 02 (`--node-options=`) and 05 (timer).

**Probe kit.** Re-create from the review §2 if needed:
- `git archive` the head, then type-strip with `scripts/build.mjs`, which rewrites `@platform/*` to the stripped paths.
- Create a junction from `build/node_modules` to the worktree's `node_modules`; remove it with `cmd //c rmdir`.

Related: [[project-p5-wave0-config-review]], [[project-p5-wave0-db-baseline]], [[project-p5-wave0-rls-spike]], [[project-security-review-conventions]]
