---
name: review-watchlist
description: Open deferred items from the PR #1 (TASK-001), PR #2 (TASK-002), PR #4 (TASK-004) and PR #5 (TASK-003) reviews, by owner task, to re-check when later PRs touch the same files
metadata:
  type: project
---

PR #1 (TASK-001) was APPROVED in round 2 at 4ec1bc4 (2026-11-12). Still open, by owner:
- TASK-015 (coverage gates): `tools/repo/coverage-scope.test.ts` drops glob-form tsconfig `include` entries (R2-m1). The `jest-util` exact pin is not tied to Jest's own copy (R2-n2).
- TASK-007: the `check-lockfile` wording in DECISIONS.md L918 says link entries have no `resolved`, but npm v3 link entries do (R2-n4).
- TASK-014: stale `dist/` output and compiled tests; require a clean context and stripping (m9, D-ARCH-038).
- ADR-0003: file-or-folder layer wording, and the `tests` folder-only rule (m5).

PR #2 (TASK-002) was APPROVED_WITH_NITS in round 2 at 6ba7649 (2026-11-12). The PR #1 items that were routed to TASK-002 are all closed, including the engines floor and lock drift. Routed from PR #2:
- TASK-015: `any-justification` must require `TASK-\d+` and cover the `no-non-null-assertion` / `ban-ts-comment` suppressions (m7).
- TASK-006: fixtures for the worker's package-specifier import form (m8). Routes may import another module's `index.ts` and so reach its service; add `module-entry` to the routes disallow (R2-n7).
- Carriers adapter task: forbid ioredis/iovalkey/bullmq in packages/carriers (m9b).
- TASK-076: `money-arith` needs a type-aware `Minor` brand check (m10).
- TASK-016: narrow the audit-writer allow-list (n5).
- TASK-007:
  - `.gitignore` ignores dist/build/coverage at ANY depth, so source folders named like that are silently untracked (R2-m1).
  - Stylelint ignores are not symmetric with the ESLint ones (R2-n8).
  - Semgrep backstop for aliased `createRequire`.
- TASK-004: add `**/playwright-report/**` and `**/test-results/**` to the ESLint and Stylelint ignores (R2-n9).
- TASK-025 and TASK-043 must use the exact Prisma paths `packages/audit/src/store/prisma-store.ts` and `apps/api/src/platform/outbox/writer.ts`.
- Web/admin may import only `@platform/shared` and `@platform/ui`. PR #3 r2 ruled that `apps/*/vite.config.ts` → `@platform/config/web` is blocked today. It needs an ADR-0003 carve-out: a `web-build-config` category, the exact subpath only, plus a devDependency (review §R2.4).
- Architect: ADR-0002 §6 stylelint script wording (n4).

PR #4 (TASK-004) r1 at 519bb89 went CHANGES_REQUESTED (2026-11-12). The only MAJOR is the open Playwright AC. Routed:
- TASK-022:
  - Nginx `gzip on` and pre-compressed `*.gz`.
  - `VITE_PUBLIC_ORIGIN` as a required build arg.
  - `/.well-known/` is blocked by the dotfile rule.
- TASK-038: theme.css does not reset `--text-*`/`--shadow-*`; the dark palette is duplicated.
- TASK-042: SPA-fallback locale hydration must be hydration-safe.
- Lazy-route task: the size-limit globs sum all chunks; the per-chunk 150 kB check and the cross-app check are missing (NFR-WEB-004).

PR #4 r3 at d2e867b (harness + merge-main; 2026-11-13) is CHANGES_REQUESTED with ONE MAJOR, R3-M1: the move tools/test-support -> tools/test-dom de-owned the jsdom env/setup files. R2.4 items 1-10, R2-m1/m2 and m2 are closed (Firefox deferred as COND-E2E-FF, D-ORCH-019). Round 4 = delta check: `/tools/test-dom/` in CODEOWNERS + REQUIRED_CODEOWNED_PATHS (check-workflow-policy.mjs:656) + its test -> expect APPROVED_WITH_NITS. The security record must name a head at or after that fix. Routed from r3: R3-n1 (use-locale reads live html lang; capture once) -> TASK-042; R3-n3 (outputDir vs §7.8 tests/e2e/output) and R3-n4 (assert pointer:coarse/44px) -> T-QA-05; R3-n6 (WebKit-Windows close hang; CI globalTimeout) -> qa-lead/TASK-015; base-ref step minimal jest config -> TASK-007/PR #17.
PR #4 r4 at e3cdb94 (2026-11-13): APPROVED_WITH_NITS. R3-M1 closed (checkCodeowners mutation probe), PR4-SEC-10 anchored ignores symmetric ESLint/Stylelint/.gitignore over 15 paths, both merges pure unions, lock +8 unchanged. Open: R4-m1 MINOR webkit-desktop SPA-fallback saw lang=en once (dev run 1) -> qa-lead/TASK-015 repeat-each on Linux with COND-E2E-FF; if it reproduces -> TASK-042 with R3-n1. R4-n1/n2 optional NITs. Merge conditions: security record naming e3cdb94+, COND-E2E-FF in traceability.md, squash.
Routed:
- TASK-022/TASK-111: `gzip_proxied`/`gzip_http_version` behind the edge or CloudFront.
- TASK-014: IPv6 `listen` with `default_server`.

PR #5 (TASK-003) r2 at 4574a14 was APPROVED_WITH_NITS (2026-11-12). r3 merge-main delta at 614eb96 was also APPROVED_WITH_NITS. The PR #1 TASK-003 items (m6, R2-n5) are closed. Routed:
- TASK-016 (owns `tools/db/lint-migrations.ts` rules 3–9/11/14):
  - R3-n1: `prisma/tests/**` has `import-x/no-relative-packages: 'off'` (eslint.config.mjs ~:417). Restrict its targets with a boundaries policy: tools-db, tools/test-support, db-platform, prisma-generated.
  - R2-m1, rule 13: `FIXED_PATH` matches anywhere, so a second `SET search_path = public` wins in PostgreSQL (last value kept); require exactly one SET.
  - R2-m2, rule 10: blind to UPDATE/DELETE inside `DO` bodies.
  - R2-n1: `U&"…"` identifiers evade rule 12 in both lanes.
- TASK-006: runtime pool `statement_timeout` (m7).
- TASK-014: reset portless URL with `PGPORT` set (R2-n3); silent deploy-timeout exit (R2-n4); `reset.ts` passes `string|undefined` bootstrapUrl, guarded only in `resetTarget` (R3-n2).
- Architect:
  - data-model §8.3 rule 13 still says "header up to AS".
  - D-ARCH-049's rule-12 "precision" sentence is superseded by deny-by-default.
  - ADR-0018 register lacks the `BOOTSTRAP_*_PASSWORD_FILE` exception.

PR #3 (TASK-005) r3 at 0e48a2a was APPROVED_WITH_NITS (2026-11-12). R2-m1 and R2-n1..n4 are closed (shared predicates, AST scan, permanent errors, slack). Gatekeeper must re-run gates on the merge-main commit with TASK-003. New NITs, optional in-PR, else TASK-022:
  - r4 merge-main delta at 3e390e0 (2026-11-12) was APPROVED_WITH_NITS. R4-n1: the compose-env SCRAM test loop does not name the failing key. gh showed no CI checks on that head; confirm CI before merge.
  - R3-n1: the web `missing` issue carries `rule: invalid_type`; the backend has none.
  - R3-n2: the differential `Verdict` lacks the rule id (mutant M8 survives the property).
  - R3-n3: the backend import graph deny-lists zod and does not follow `@platform/config/web` self-reference; switch to an allow-list.
  - R3-n4: BRAND_NAME accepts controls, bidi and lone surrogates (it reaches e-mail headers).
Still open from r2:
- TASK-014 / migrate-job owner:
  - R2-m2: tooling keys get no placeholder or verify-full check in the tools themselves.
  - The inspector guard only detects; a Checkov or task-def NODE_OPTIONS lint is needed.
- TASK-006/014: file provider `O_NOFOLLOW` and TOCTOU; m4 `loadRuntimeConfigOrExit`; m5 holder enforcement.
- Crypto tasks: m6 local key derivation.

**Why:** these were deferred as tracked conditions, so they can slip silently into later PRs.

**How to apply:**
- When a PR touches any of these, grep for the matching item: jest.config.ts, the tsconfigs, .npmrc, the lockfile checks, prisma, Dockerfiles, infra/nginx, theme.css, .size-limit.json, i18n, eslint.config.mjs, .gitignore.
- Drop an entry once it is verified fixed.
- Fix cycles that list the mutation or fixture proving each guard worked well (PR #1 r2, PR #2 r2). Ask for that again.

PR #6 (TASK-009, SPK-02 carrier docs) r1 at 4e5d05f went CHANGES_REQUESTED (2026-11-12).
- M1: the UPS GIF→PDF recommendation assumes pdfkit reads GIF. pdfkit 0.20.2 reads JPEG/PNG only (`Unknown image format.`). UPS Label Recovery lists `PDF`. REQ-DOC-002 is PDF-only.
- m1: the FedEx SDK F5 `index.js` confirms the ship, cancel (PUT) and address-resolve paths that the README marks unverified.
- Also open: m2 pin source SHAs; m3 DHL sandbox/prod share a host, so bind base URL to env and never follow carrier-returned URLs; m4 PII in query strings (DHL `requestorName`) and data minimisation.
- r2 at f0387d4 was APPROVED_WITH_NITS (2026-11-12). M1, m1–m4 and n1–n7 are closed. The UPS PDF decision is ADR-0010 am. 11 item 3: Label Recovery plus an optional `recoverLabel`. CI was empty on the head.
- R2 NITs, routed:
  - TASK-191: README heading "Personal data and secrets" vs US-137's "PII and redaction"; the UPS Docs URL row lacks a SHA.
  - TASK-140: Label Recovery `Code` has minLength 4, but "PDF" is 3 characters (`Shipping.yaml:13499`).
  - TASK-113: prefix match must respect path-segment boundaries, because the `/security/v1/oauth/token` prefix has no trailing slash.
  - TASK-135: DHL README §3.3/§8 are stale; add the `create-timeout-then-tracking-reconcile` fixture.
  - Architect: am. 11 gives npm `time.modified` dates as release dates.
- When TASK-113/135/139/140 PRs land, check that m3 and m4 are implemented: per-adapter EGRESS tests, query stripped from logs, inline labels only, DHL `requestorName` constant, token-endpoint 403 cool-down.

PR #7 (TASK-008, SPK-03) r2 at 065aa3e was APPROVED_WITH_NITS (2026-11-12). M1 and m1–m7 are closed in-PR; (d) is opt-in via `SPK03_BENCH=1`. Routed, check when TASK-016 lands:
- R2-m2 (orchestrator): the TASK-016 C-1 sheet line (WAVE-00.md ~:589) must set `SPK03_BENCH=1`, otherwise the hosted run skips (d) and the C-1 artifact is empty. The ported suite asserts server-side p95 ≤ 1 ms without the flag. Then the spike file is deleted.
- R2-m1 (architect): ADR-0005 am. 10 item 4 asks for a negative control proving that session-level `app.*` "cannot be set by platform_app". That is infeasible (USERSET placeholder); the control must prove the leak instead.
- R2-n1/n2 (architect): the "existing lint rule" claim is back in am. 10 item 2. Item 12 lists a statement_timeout role default that does not exist. data-model §4.1 still has 6 settings while item 12 adds lock/idle timeouts.
- TASK-016 PR: check the ALS `NESTED_TENANT_TX` guard, the TenantDb Proxy, `mapDbError` on `originalCode`, the token ban, and the ported F-04 negative control.

PR #8 (TASK-013 authz catalogue) r2 at 498e3a5 was APPROVED_WITH_NITS (2026-11-12). M1–M3, m1–m6 and n1–n3 are closed. Still open:
- R2-m1 (MINOR): a verb in the action segment with a `read` qualifier (`shipment:void:read`) classifies as read. Fix in-PR or route to TASK-020. When TASK-020 or the next authz PR lands, check for a `SUB_RESOURCES` middle-segment allow-list in `checkKeyShape`.
- R2-n2: `ASSIGNABLE_BY` needs a target ⊆ assigner property test (TASK-231/235).
- R2-n3: the v1 pin lives beside the generator; the TASK-016/007 migration-immutability check vs origin/main must exist.
- R2-n1: Auditor `audit:*` breadth (architect).
Routed:
- TASK-023 must not seed `permissions`, `roles` or `role_permissions`.
- TASK-016's R3-n1 allow-list gains the `prisma/tests → tools/authz` edge.
- Any CATALOGUE_VERSION bump needs the delta renderer first (`artefacts()` throws above v1).

PR #9 (TASK-006 runtime skeleton) r1 at 374166d was CHANGES_REQUESTED (2026-11-12). Review: `docs/05-quality/reviews/PR-0009-TASK-006-code-review.md`.
- M1: the session-integrity start-up check equates "first readiness probe" with "fresh connection". A '' left by a tx-local set_config becomes `db_session_default_tampered`, and the 5-min cache makes the 503 sticky. Fix: an eager boot check on a dedicated `pg.Client`, and no caching of failing results.
- m1: a corrupt gzip body returns 500 (body-parser `status:400`, no `type`). m3: public `/health/ready` has no single-flight. m4: problem responses lack `Cache-Control: no-store`.
- Routed:
  - m2 (orchestrator): no sheet owns replacing `pendingCheck` for object_storage, audit_partitions and audit_chain.
  - m5 (TASK-010): prove AT-US-007-03 "full error in logs".
  - n2 (TASK-214): add a pre-close delay.
  - n4 and n8 (TASK-016): the pin test must parse every bootstrap/*.sql; add a not-ready latch.
  - n10 (first BullMQ task): BullMQ needs `maxRetriesPerRequest: null`.
- Closed by PR #9 (r2 to verify): PR #2 m8 and R2-n7; PR #5 m7; PR3 m4, m5, SEC-05, SEC-06, SEC-07 and SEC-16; PR5-SEC-07 and SEC-08; PR7-SEC-03 items 2 and 4.
- r2 at 05855b1 is still CHANGES_REQUESTED (2026-11-12).
  - Closed: M1, m1, m3, m4, n1, n3, n7.
  - **R2-B1 BLOCKER:** the PR9-SEC-01 `MEDIA_TYPE` regex in json-body.ts has an optional param plus OWS on both sides of `;`. That is exponential ReDoS: about 80 bytes of Content-Type means about 100 s of event-loop stall, unauthenticated, on any path.
  - Fix: move the post-`;` OWS inside the optional param, plus a length bound and timing tests.
  - R2-m1: the tripwire `pending` half in services.test is vacuous; ask for a `isPendingCheck` brand.
  - R2-m2: single-source the DATABASE_URL param allow-list in @platform/config (the runtime set wins; drop `uselibpqcompat`). Merges with n6.
  - R2-n1: the fallback problem ignores `typeBase`.
  - r3: re-run the ReDoS probe (`';  '`×20+`'!'`) on the fix. Still open: n5 (FIFO `O_NONBLOCK`).
- r3 at 6331aeb: APPROVED_WITH_NITS (2026-11-13). R2-B1, R2-m1, R2-m2 (names) and R2-n1 closed.
  - R3-m1 MINOR: DATABASE_URL *values* still differ between config and runtime (`sslrootcert=system`/relative passes staging config, then exit 1). Fix at merge-main or route to TASK-014 with n5 (n5 now also covers the sslrootcert stat→read TOCTOU).
  - NITs: the order "bounded check before req.is" is not pinned by a test; client.test has an orphaned JSDoc.
  - r4: review the merge-main delta only (pure-union proof, coverage, CI rollup); security-analyst confirms PR9-SEC-14.
- r4 at 5e6119d (merge of 6331aeb + main c998d07): APPROVED_WITH_NITS (2026-11-13), pure union, no findings. R3-m1 routed to TASK-014 (orchestrator ruling). Remaining: scans red until the PR #9 security record is on the head; PR9-SEC-14 confirmation.

PR #10 (TASK-007 lane A) r1 at 28442b6 was CHANGES_REQUESTED (2026-11-12). Review: `docs/05-quality/reviews/PR-0010-TASK-007-code-review.md`.
- M1: `--ignore-scripts false` and the npm install aliases bypass check-install-flags and check-workflow-policy.
- M2: gitleaks can be suppressed by the head (`.gitleaksignore` auto-load; `gitleaks:allow` without `--ignore-gitleaks-allow`).
- M3: repo settings allow merge commits and rebase merges, and the squash title is COMMIT_OR_PR_TITLE, so PR-title commitlint is bypassable. The settings change alone closes it.
- MINORs:
  - m1: the YAML parser must reject CR, NEL, LS and PS.
  - m2: security-owned check needs `--no-renames`, and the merge-main invalidation must be intersected with the PR's owned paths.
  - m3: the base-ref suite still runs the head harness; `.semgrepignore` comes from the head.
  - m4: CODEOWNERS gaps (`.gitleaksignore`, jest.config.ts, tsconfig, commitlint config).
  - m5: minutes (drop the `changes` job); cancel-in-progress on main; push paths filter.
  - m6: no branch protection on this plan.
  - m7: no cap on waiver horizon.
- r2: re-check each fix has negative fixtures.
- Closed by PR #10 (verified):
  - PR #2: R2-m1 gitignore anchoring, R2-n8, Semgrep `createRequire`.
  - PR #8: R2-n3 (migration immutability).
  - PR #1: R2-n4 (in code).
  - TASK-015 m7 (any-justification TASK-ID) is partly closed.
- After merge, PR #9 is the first PR under the enforced security-record gate.
- r2 at 26fc08d was APPROVED_WITH_NITS (2026-11-13).
  - Closed: M1 and M2 (verified with npm 11.19.1 and git); M3 procedurally (D-ORCH-012/013); m1, m2, m4–m7.
  - m3 is partly closed.
  - Open MINORs, in-PR or TASK-015:
    - R2-m1: npm reify commands (`update`, `dedupe`, `uninstall`, `link`, `audit fix`) and `--ignore-scripts $VAR` give 0 findings.
    - R2-m2: required-gates, gitleaks-hardening and scans-isolation are tripwires (`|| true`, `--mount`, `$PWD`, `--exit-code 0`, `node tools/ci/x.mjs` all pass).
    - R2-m3: Semgrep ≥1.117 honours nested `.semgrepignore` files.
    - R2-m4: `${{ env.X }}` in `run:` passes untrusted-expression.
  - NITs: R2-n1..n8. n8 is one line: `pull_request.branches: [main]`.
  - When TASK-015 lands, check R2-m2/m3/n7 before any new workflow or gitleaks mount.

PR #11 (TASK-016 RLS foundations) r1 at 557aada was CHANGES_REQUESTED (2026-11-12). Review: `docs/05-quality/reviews/PR-0011-TASK-016-code-review.md`.
- M1: the TenantDb Proxy is shallow. `db.$parent` returns the unguarded itx client (with `*Unsafe` and `$transaction`), `db.$parent._originalClient` is the ROOT client, and the same holds via `db.<model>.$parent` and the Prisma private `Symbol()` key. Fix: deny-by-default top level plus child proxies on delegates; tests on the real `_createItxClient` shape.
- MINORs:
  - m1: rule-16 / C-series literal exemption beaten by `'' || 'app.org_id'`, `'app.' || 'org_id'` and `SET "app"."org_id"`.
  - m2: the C5 ACL query drops PUBLIC (`grantee <> 0`).
  - m3: the PR #9 second-merger list (§7 a–f) — composition root imports client.ts; the tenant-context ban hits PR #9 tests; config/.env textual conflicts.
  - m4: C6–C10 absent.
  - m5: `Prisma.raw` / non-tagged `$queryRaw`.
  - m6: PR #5 R2-m2 (DO bodies, rule 10) still open.
- Closed by PR #11 (verified): PR #2 n5; PR #5 R3-n1 plus PR #8's tools/authz edge; PR #5 R2-m1 / PR5-SEC-11. PR #5 R2-n1 (`U&`) is still open.
- r2: re-probe M1 with the real itx shape and m1 with the 9 bodies. Check §7 when PR #9 or PR #11 merges second.
- r2 at a3e8edd: CHANGES_REQUESTED (2026-11-13). M1, m1, m2, m4, m6, n1 and n4 are closed.
  - R2-M1 (MAJOR): `PrismaPromise.requestTransaction(null)` on guarded results runs on ROOT. Fix: a lazy then/catch/finally wrapper.
  - MINORs:
    - R2-m1: `Prisma.raw` alias forms are not linted, and a nested raw value interpolates.
    - R2-m2: the ESLint tenant-context twin misses `SET "app"."org_id"`.
    - R2-m3: architect item 1 (no `RESET lock_timeout` check above 3s) and item 2 (bare `OWNER TO platform_definer` not flagged).
  - Reconciliation pass still owes: (a)–(f), PR11-SEC-09 items 1–6, architect items 5, 6 and 8.
  - r3: re-run the recording-adapter probe (`requestTransaction`, late await), the alias lint probe and the rule-11/15 probes.
- r3 at 37a2109 (fix + merge d68898a + reconciliation): APPROVED_WITH_NITS (2026-11-13). R2-M1 closed (4/4 mutations killed), merge pure union, D-ORCH-014 (a)–(f) and SEC-09 1–6 met.
  - Open: R3-m1 (SEC-09 item 4 metric + TASK-010 sink deferrals have no owner; runner dormant until TASK-020 passes `Client`); R3-m2 (PGOPTIONS → exit 1, not 78; fix in-branch or TASK-014).
  - NITs: n1 db-raw-sql container laundering; n2 ESLint twin lacks U& + comment strip; n3 rule 11 misses `set_config('lock_timeout',…,false)`; n4 fluent accessors typed but absent; n5 no exemption-file-exists tripwire; n6 DbProblemCode not tied to ErrorCode.
  - Superseding branch (D-ORCH-018): check tree == `git diff 63accea 37a2109` + listed fixes only; lane A green after main's base-ref subset fix.
  - PR #18 supersede r1 at 0f9ff27 (2026-11-13): APPROVED_WITH_NITS. Tree == 37a2109 for 376 files, == main for 39; no ancestors/merges; negative-fixtures resolution keeps all exact assertions (m3 a/b split). R3-m1 owners in STATUS ROUTED; R3-m2 -> TASK-014. Conditions: security record on 0f9ff27, lane B integration, SQUASH (eac026a alone fails unit). Next: delta-only if head moves.

PR #12 (TASK-012, SPK-08) r1 at 2e0aa32 was CHANGES_REQUESTED (2026-11-13). Review: `docs/05-quality/reviews/PR-0012-TASK-012-code-review.md`.
- M1: "`migrate dev` vs raw-SQL partial indexes" was routed to TASK-012 only by batch-3 rulings :43 and is orphaned. Answer it or re-route it with an owner.
- M2: the guard's `sql_drop` refusal branch is never exercised (R-ARCH-18 "schema-owner DROP TABLE"). Test as `SET ROLE platform_schema_owner`.
- M3: lifecycle. Both spike suites break when TASK-021 adds the real `prisma/bootstrap/10-audit.sql`, so TASK-021's PR must port and delete them. The anchor files have no owner.
- m1: F-01's premise sits behind an `if`; the shadow contents are unasserted. m4: F-04 is already in data-model §7.3 A17; the real gap is that the by-name tolerance cannot see a lost INCLUDE.
- r2 at 0dc3ae9: APPROVED_WITH_NITS (2026-11-13). M1–M3, m1–m5 and n1–n7 are closed.
  - R2-m1 MINOR: the F-11 TASK-016 rule ("no DROP of a WHERE index unless re-created") passes a re-create WITHOUT `WHERE`. The case is preview on + plain `@@index`. Check the TASK-016 rule wording.
  - Lifecycle (SPK-08 §8.1):
    - The TASK-021 PR must delete the audit-owner test, `spk08/{10,90}-*.sql` and `spk08/prisma.config.ts` in the porting commit, and port the sql_drop, planted-name and F-02 cases.
    - The TASK-116 PR (the anchor writer and verifier, not TASK-033) must delete the anchor test and `anchor-prototype.ts`, and pin the golden vectors in a packages/audit unit test.

PR #13 (TASK-023 seed framework) r1 at e92cd6f was CHANGES_REQUESTED (2026-11-13). Review: `docs/05-quality/reviews/PR-0013-TASK-023-code-review.md`.
- M1 (docs only): US-049 is planned as "completes", but AT-02/-05/-09/-10 are unmet and TASK-089 and TASK-014 do not own them. Needs a re-scope decision, sheet ATs and a PR-body relabel.
- MINORs:
  - m1: CLI crash on a dropped connection (no pg `'error'` listener; exit 1, non-JSON). bootstrap.ts has the same gap (TASK-014).
  - m2: URL `options=`/`statement_timeout=` override the pinned session.
  - m3: readSecret copy; `DATABASE_MIGRATOR_URL_FILE` unregistered.
  - m4: Dataset contract cannot do uuid-FK children (`id` reserved), NND null keys, partial arbiters, or insert-only columns. `number_sequences.next_value` would reset on every deploy, so check every later dataset PR for this.
  - m5: drift restore of an audited dataset is not audited.
  - m6: PR #11 merge-second gives 5 `boundaries` errors in seed.int.test.ts:19-23; add a `prisma-seed` category.
- r2 at e42e368 (2026-11-13): APPROVED_WITH_NITS. Closed m1/m2/m3/m5(edits)/n1-n6/n8; probes pass (exit 2 JSON; 0/280 URL overrides; 7/7 mutations killed).
  - Open: R2-m1 deletion drift (`else if (updated > 0)` misses re-inserted rows) → fix in superseding branch or route TASK-025. R2-n1 README dup line; R2-n2 3rd copy of URL-param predicate; R2-n3 no client query_timeout/keepAlive (→ TASK-014).
  - PR #19 supersede r1 at 699f33d (2026-11-13): APPROVED_WITH_NITS. Tree == e42e368 for 34 files, 2 overlap files == clean merge-file, 0 ancestors/merges; R2-m1, R2-n1, m6 closed (mutations killed); M1 fold done on main (D-ARCH-079). Open: R19-n1 NIT (migration header still lists authz_matrix as an example row; immutable after merge). Conditions: security record on 699f33d, SQUASH (commits 1-7 red), integration on head, close #13. Later dataset PRs: check m4 a-d (counter reset, NND keys, partial arbiters, uuid FKs).

PR #17 (TASK-007 follow-up, base-ref lint fixtures no-weakening) r1 at ea78d38: CHANGES_REQUESTED (2026-11-13). Review: `docs/05-quality/reviews/PR-0017-TASK-007-code-review.md`.
- M1: null-ruleId extras ("Unused eslint-disable directive") pass; `no-explicit-any` off repo-wide → new base run green, old failed. Fix: fail null-ruleId extras (+ relaxed check on ok-*), E9.
- m1 gate deny-list misses `--test-name-pattern`, `-tX`, `--listTests`, `-o`; m2 head jest.config.ts `testNamePattern` → 97 skipped exit 0; m3 positive halves in lint-wiring tests + `noWeakening` hard-codes 'error'.
- r2 at 8dd1d24 (2026-11-13): APPROVED_WITH_NITS. M1/m1/m2/m3(a)/n1-n4/n6 closed (M-a and M-b exit 1 via the real step script; exact command pin; base Jest config tools/lint/jest.base-fixtures.config.json). Merge needs the security record.
  - Open: R2-m1 (pre-existing) no fixture/effective check that no-explicit-any is on; off + reportUnusedDisableDirectives off passes → in-PR or TASK-015. NITs: R2-n1 pin trimEnd vs bash backslash-space (fails closed 127); R2-n2 .swcrc in WAVE-00/plan-data/ADR-0023; R2-n3 job-level env comment.
  - PR #11 overlay ruling: exactly 4 prisma-client-construction extras (2 bad-orders.service, 2 ok-orders.repository), 0 failures. PR #11 supersede: WARNINGS via expectFindings(…,"warning"), allowed (TASK-016) via expectClean.
  - PR #4 merge-main: unit-dom transform must become [@swc/jest, SWC_JEST_OPTIONS] (jest-transform.test); no .swcrc.

PR #21 (TASK-017 OpenAPI pipeline) r1 at b0ede35: CHANGES_REQUESTED (2026-11-13). Review: `docs/05-quality/reviews/PR-0021-TASK-017-code-review.md`.
- **M1:** `tools/openapi/drift.ts:122` skips a path-mounted handler (`router.use('/x', fn)`). Fix: `slash !== true` gives unrecognised; verified green on the copy.
- **MINORs:**
  - m1: pinned `now` in the real drift run.
  - m2: `api-mounts.ts` mirrors `createApp`.
  - m3: OPTIONS 204 not mirrored in the 405 `Allow`, the validator or the stubs.
  - m4: `no-relative-packages` `'off'` for `tests/api/**/*.api.test.ts`.
  - m5: README §15 rule 7, the supertest ban, the coverage report, SSE and `client.ts` neither delivered nor recorded.
  - m6: NFR-MAINT-004 `oasdiff` unowned.
  - m7: AT-US-035-01 checked at the HTTP level only.
- **Round 2 = delta check.** Also: the security record must name the fix head; PR #20 conflicts in app.ts, main.ts and request-context.ts; TASK-014 must ship openapi.yaml (compose `DOCS_ENABLED=true` means exit 78 without it).
- r2 at b31483b (2026-11-13): APPROVED_WITH_NITS. M1, m1-m4, rule-7 part of m5 and N1-N7a are closed, with mutants killed. Merge bf3d1f7 (main d38500a) is a pure union; no lock delta. Routed per D-ORCH-023: supertest ban + coverage report -> TASK-020; SSE -> TASK-044; client.ts -> TASK-065; oasdiff -> TASK-015 before the v0.1.0-m0 tag; CSP render smoke incl. BaseLayout -> TASK-022.
  - **R2-m1 MINOR (open unless fixed in-PR):** `resolveMountPath` accepts array mounts (`layer.matchers.length > 1`), optional groups (`/api/v1{/:x}`, `/api{/:v}/v1`, `{*rest}`), and skips root sub-apps (`mounted_app`). The verified fix: a single matcher, an insertion probe, and a check that matching `relative + '/' + probe` leaves `layer.path === relative`. If routed -> TASK-020; check it there.
  - NITs: R2-n1 the eslint ignore `^(?:\.\./)+apps/api/src/` is unanchored, so a traversal passes; R2-n2 `layer.path !== relative` is a surviving mutant; R2-n3 the app.ts:6 comment; R2-n4 D-TASK017-01 (2)/(4) text is stale.
  - **PR #20 union (whoever merges second):** PR #20's `routes.use(API_PREFIX, routePrefix(API_PREFIX), api)` becomes unrecognised-route under the R1-M1 fix, so AT-US-034-01 fails. Move it to `api.use(routePrefix(API_PREFIX))`. Check this on the merge commit.
  - TASK-020/048: a limiter or CORS mounted under a path fails the drift check by design. Mount it path-less or add a tested WalkOptions exclusion.

- r3 at e046ea2 (delta drift.ts, 2026-11-13): APPROVED_WITH_NITS. R2-m1 closed (6 shapes + Application sub-app; real app 0 unrecognised), R2-n2/n3 closed; no CODEOWNERS path in the delta (checker says not-required). Open, owner TASK-020 via D-TASK017-01: R3-m1 RegExp mounts with alternation (`/^/api/(v1|v2)/`) still fail open; R3-n2 path-less sub-app on a Router (name `app`, not `mounted_app`) skipped; R3-n1 add a leading-param test (`/:x/v1`).

PR #20 (TASK-010 logging) r1 at dae1f96: CHANGES_REQUESTED (2026-11-13). Review: `docs/05-quality/reviews/PR-0020-TASK-010-code-review.md`.
- M1: `@platform/shared/logging` (Pino) importable from web/admin/ui/pricing with 0 lint errors (toPackage allow expands to `/**`); needs disallow + fixtures per arm (lint lock -> orchestrator ruling). M2 (docs): AT-US-008-03 PARTIAL, owners TASK-029/035/047/saga do not own it; WAVE-00:9 says US-008 completed.
- MINOR: m1 stack getter native check bypassed by bound/Proxy (fix: identity vs V8 accessor); m2 deny-list PII filter on security events (ask per-event allow-list from §13 Extra fields); m3 RUNTIME_SECURITY_EVENTS lists 1 of 5 (tampered/privilege_denied fall to warn); m4 free-text gaps (4+ spaces, newline, 2nd Cookie pair, \" JSON, IDN e-mail); m5 no per-line budget (16 MB / 3.9 s).
- r2: re-run the lint probe (4 importers), bound/Proxy getter probe, PII probe, leak vectors; PR #21 union conditions (§6.4).
- r2 at 9647907 (2026-11-13): APPROVED_WITH_NITS. M1, M2 (D-062), m1-m5, n1-n9 closed (n8 routed); 22/22 mutants killed; both merges pure unions; lock delta still the single pino edge. D-ORCH-025 (all 5 runtime DB events at `error`) accepted.
  - Open MINORs (in-PR preferred, else routed): R2-m1 the shared ROOT barrel may re-export logging (probe gives 0 errors), fix = a policy from non-logging packages/shared files; R2-m2 the general-line PII parts miss openapi `display_name`/`receiver_name`, plus username/client_ip/forwarded-for.
  - NITs: R2-n1 free-text JSON array/object values, PEM, full-width keys; R2-n3 `Object.keys` is uncharged (2 s for repeated huge objects) and `err` + escaping sit outside the 16 KiB budget (50 KB line); R2-n4 log.ts:7-9 stale; R2-n5 the PR body union note still says `routes.use(API_PREFIX, routePrefix…)`.
  - **Union (PR #21 first):** the auto-merge KEEPS the path-mounted routePrefix, so move it to `api.use(routePrefix(API_PREFIX))`. Install `installProcessErrorHandlers` before PR #21's createApp try block. PR #21's `{info,error}` test loggers need `debug`. Keep `resolveCorrelationId`. A merge-only security round applies (eslint auto-merges).
- r3 at fafa3b5 (2026-11-13): APPROVED_WITH_NITS. Union (a)-(j) met (merge 3153b3e vs merge-tree = exactly 8 files; drift 0 unrecognised, old mount mutant fails 4). R2-m1/m2 closed (3/3 lint, 10/10 redaction mutants killed); SEC-13 items 1-3 + PR21-SEC-07(b) done; free-text OMITTED over-redaction ruled acceptable. NITs: R3-n1 exitAfterFlush JSDoc says Windows pipes async (reproduced sync on Node 24; TTY is the async case); R3-n2 TARGET_LEAD misses `| ; { @`; R3-n3 omitted-key object value ends at first comma (join R2-n1, TASK-113/214); R3-n4 lint `test/`-folder two-hop + double-escaped lists; R3-n5 deferred exit can write 2nd fatal line.
  - Merge: security delta record on final head; lane-B evidence after PR #28 (merge main BEFORE evidence); lane B integration; squash. Second-merger notes: #30 main.ts keep `secrets` + PR #20 log/handlers; #26 packages/shared deps {pino, uuid} + regenerate lock; #24 runtime.ts/tools tsconfig + DbSecurityEvents vs exhaustiveness test/SECURITY_EVENT_FIELDS.

PR #24 (TASK-021 audit store SQL) r1 at 6f498c4: CHANGES_REQUESTED, r2 at 7662672 APPROVED_WITH_NITS (2026-11-13). Review: `docs/05-quality/reviews/PR-0024-TASK-021-code-review.md`.
- **R1-M1:** the PR #21 union is not pure. On the merge tree, `openapi:types --check` exits 1, and `tests/api/contract-validation.api.test.ts:24` has a local CRITICAL list, so 4 api tests fail with the criticality TypeError. Fix: `isCriticalComponent` plus audit_partitions unavailable/degraded variants (verified, with a negative control). Also fix the getReadiness description.
- **R1-M2:** guard layer-1 bypass via `CREATE TYPE … AS RANGE (multirange_type_name = audit_entries_YYYY_MM)`. Fix: a post-loop invariant (no non-audit-owned pg_class/pg_type ~ c_tbl in v_ns), verified on PGlite. It must land before merge, because 90-guard becomes immutable after that.
- MINORs:
  - m1: AT-US-012-04 wording ("next partition missing → degraded") versus 503; PM plus architect, and an out-of-window squat should give degraded.
  - m2: the squat event is logged at warn (D-ORCH-025 says error). PR #20 union: its exhaustiveness test breaks on the new DbSecurityEvents, and SECURITY_EVENT_FIELDS must allow name/kind/reason.
  - m3: bootstrap files have no CI immutability check (TASK-015).
- NITs: n1 rule-11 DO depth > 4 fails open; n2 `pendingCheck('audit_partitions')` passes; n4 intervalCache keeps `unavailable` for 60 s; n6 TASK-014 image must ship tools/db for prisma.config.
- Closed by PR #24: PR #12 M3 port-then-delete; PR #11 R3-n5; PR #9 m2 (audit stubs); PR #5 R2-n1 (U&, both lanes); PR11-SEC-17 c DO half.
- **r2 at 7662672 (2026-11-13): APPROVED_WITH_NITS.** R1-M1/M2 and n1-n4/n7 closed; m1 closed by D-ARCH-081 (current+3); 57 PGlite rows, r1 guard as negative control (P1*, L3-L5, procedure/aggregate plants accepted there, refused now). Union: head minus merge-tree(6f498c4, main) = the 4 fix commits exactly.
  - NITs: R2-n1 only type/domain/sequence/procedure/aggregate squats can be dropped by the migrator; table/view/matview/index/function squats are also refused by sql_drop and need trigger suspension (goes to data-model 5.2 + TASK-090 runbook, NOT into 90-*.sql, since a new blob needs a new rule-12 approval). R2-n2 the invariant roughly doubles DDL cost on PGlite. R2-n3 the `to_regprocedure` NULL disables the routine arm if the guard is renamed (superuser only); handle it in the next guard version.
  - Merge: security r2 record naming 7662672 / blob 9aab9aa; squash; lane-B evidence if PR #28 lands first (D-ORCH-034).
  - Second-merger steps: PR #20 RUNTIME_SECURITY_EVENTS + per-event fields + `security.emit` with `component` dropped; PR #30 readinessChecks(db, audit, valkey, objectStorage); PR #26 keep both DbErrorReason sets + runStartupAuditPartitionsCheck (catalog-std gives 0 findings on the audit tables). All in review section R2.5.

PR #23 (TASK-011 lane B heavy lane) r1 at f61e55d: CHANGES_REQUESTED (2026-11-13). Review: `docs/05-quality/reviews/PR-0023-TASK-011-code-review.md`.
- **R1-M1 MAJOR:** `/tools/quality/` is not in CODEOWNERS or REQUIRED_CODEOWNED_PATHS (proved with `check-security-owned-paths.mjs --pr 23`: owned = ci.yml, .prettierignore, package.json, ci-policy.test.ts only). Fix = CODEOWNERS line + required path + mutation test. Round 2 = delta check -> expect APPROVED_WITH_NITS.
- MINORs: m1 rule 4 (planned-suite JUnit) only rejects the run, check still PASS when nothing required; developer's "activation PR fails on its own evidence" is wrong (it passes, run uncredited); m2 ci-policy test pins only the PREFIX of the base-ref line, appending `--report-only` passes the test and workflow policy; m3 step unconditional, so a push-to-main (squash) range makes every git_sha a non-ancestor once suites are active (CI_MAIN_FAST_LANE unset today); m4 no tests for the newest-30 window, touched/untouched split or multi-root runs.
- NITs: Jest report reads not try/caught; same-minute re-run can half-write; clean-tree check vacuous in CI and blind to ignored files; JUnit parser rejects raw `>` in attributes and DOCTYPE in CDATA (fail closed); `--suites` runs default into real docs tree; stale doc links/paths (security-test-cases.md, tooling_inputs, ADR-0023 am. B schema path).
- Decisions D-TASK011-01..04 accepted (active-only, schema in tools/quality, one summary per root, unit = unit + unit-dom). Union with main 84d9299 clean (tree dbf09fa); PR #20/#24 zero overlap.
- **r2 at c0b1b31 (2026-11-13): APPROVED_WITH_NITS.** R1-M1/m1-m4/n1-n3/n5/n6ab closed; 9 mutations (CODEOWNERS line, required path, --report-only on base line, --event removal/unknown, rule-4 hard, window 30->31, touched-run union) each turned the intended test red. Open NITs: README verdict list still says "FAIL on planned JUnit" (R2-n1, docs); new ci.yml trigger needs `EVENTS` extended or lane A exits 2 (R2-n2); `--report-only` tripwire only in ci-policy test, not in check-workflow-policy (R2-n3 -> TASK-015). Merge needs a security record naming c0b1b31 + green lane A on exact head.
- When TASK-015 or any qa-lead activation PR lands: check R1-m1..m4 and that `unit` is the first suite flipped. Base-ref Ajv path verified out of tree (25/25).

## PR #25 (TASK-007 CI follow-ups: gitleaks OpenAPI allowlist removal + dependabot TS-major ignore) r1 AWN (2026-11-13)
- Verdict APPROVED_WITH_NITS at 20a0fc6; mutation (18 mutants) killed all but: rule-level `[[rules.allowlists]]` for openapi.yaml (N2), `typescript` ignore moved to the github-actions ecosystem (N1, test regex not ecosystem-scoped), `@platform/*` ignore removal (untested, pre-existing). N3: `toHaveLength(2)` cooldown count breaks when docker/terraform ecosystems land (TASK-014/017).
- Merge condition: security record commit turns "security-owned paths" step green. Lane A gitleaks reads BASE config, so it never exercises the new one; static proof = added lines of openapi.yaml commits in open PR ranges (first-parent) matching old allowlist shapes without EXAMPLE = 0.
- Mutation pitfall: `replace('semver-major', ...)` hit the comment line first; replace the full `version-update:semver-major` literal.

## PR #27 (TASK-018 SPK-04 audit write spike) r1 CR at aa1cfb1 (2026-11-13)
- Review: `docs/05-quality/reviews/PR-0027-TASK-018-code-review.md`. Two MAJORs, both cheap: **M1** the DB-coupled harness (server.ts, runner.ts, fixtures 20/30) reads `spk08/10-audit.sql` + `90-audit-ddl-guard.sql`, which open PR #24 (TASK-021) deletes, and PR #24's real `10-audit.sql` creates the same tables as fixture 20; no CI runs runner.ts so it rots silently (SPK-04 §8 says TASK-030, truth is TASK-021). My ruling: drop server/runner/fixtures, tag `c037470`, keep k6 script + eslint block + pure modules (canonical/chain/verdict + 27 tests). **M2** doc text claims beyond the evidence (docker-stats 54% is the collapsed rep-1 `off` arm, `on` rep 2 = 134%; "0.26 cores/replica" not in artefacts; "structural in both reps" while 0 of 6 arms valid; lock-hold = RTT model predicts ~3 ms mean wait vs 97.7 ms measured, implied hold ~15 ms vs 7.5 ms).
- MINORs: n=2 + fixed arm order (rep-2 `off` follows an invalid batched arm; rep-1 clean baseline fails the budget at 150 rps), prototype audit_entries RLS vs data-model "SYSTEM, no RLS" (PR12-SEC-08), round trips are harness-counted not measured, integrity step `.catch` fails open.
- r2 = delta: check the deletion commit, SPK-04 §0/§7/§8 wording, tag or branch reference, security record on the final head (eslint.config.mjs owned), whichever of PR #24/#27 merges second leaves no `spk08`/`spk04` dangling reference.
- Routed: TASK-280 (>=5 reps, ABBA order, hold-time + pg_stat_statements, batched EXPLAIN), architect (NFR-AUDIT-005 wording; lever (b) changes chain semantics, do not pre-select), data-model §5.4 step 3 `decode(repeat('00',32),'hex')` (verified 42804 on PGlite).
- **r2 AWN at a5cfd4b (2026-11-13).** Harness kept (D-ARCH-089), repointed to real bootstrap via runBootstrap, fixture 20 deleted, paths.ts/paths.test.ts tripwire (mutation-proven: delete bootstrap/k6/migration/runtime file, product import, SPK04_AUDIT mention all fail), fail-closed integrity (verdict.ts), product-state asserts ('A', no RLS). Open: R2-m1 doc says "1.3 to 1.9 cores in the `on` arms" (on = 1.3-1.4; 1.9 is rep-1 batched); nits stale "§5.3, F-4" xref, prefix-match `toContain('CREATE TABLE public.x')`, chain.ok true when empty. Merge needs merge-only security record for the new head (scans/ci-gate red only on that step), squash with linted title. Main moved after the last merge touches only STATUS/agent-memory (no overlap).

## PR #28 (W0-ACT-1 suite activation, qa-lead) r1 CR at 22c6461 (2026-11-13)
- Review: `docs/05-quality/reviews/PR-0028-W0-ACT-1-code-review.md`. APPROVED_WITH_NITS. Merge needs security record `PR-0028-*` (tools/quality is code-owned) plus a docs-only commit for R1-m1 (no gate check that `required_cases_pending` is empty at v0.1.0-m0/G3) and R1-m2 (PR body "head checker accepts" true at dbfe4df, false at 22c6461).
- Open follow-ups: R1-m3 senior-developer adds SEC-TC-29/22/14 to TASK-020/172/049 AC (only SEC-TC-55 is in a task AC); devops narrow `.claude/agent-memory/**` staleness pattern (D-ORCH-034) after security ruling; devops gate check on non-empty pending.
- Post-merge reality (reproduced): non-docs PR needs fresh `quality:heavy --profile pr` evidence on an ancestor of head; `.claude/**` and root files match no path rule so they select lane B/unit; `stalenessAllowed` = docs/** only, so a merge of main bringing `.claude/agent-memory` stales evidence.

## PR #30 (TASK-019 SPK-05 S3 adapter vs RustFS, real object_storage readiness) r1 AWN at 293fb62 (2026-11-13)
- Review: `docs/05-quality/reviews/PR-0030-TASK-019-code-review.md`. 0 BLOCKER/MAJOR, 7 MINOR. Lane A 43379209671 green on the head; Docker suites not re-run.
- m1 timeouts/maxAttempts unpinned (deleting them leaves 78 tests green) + F-10 reproducible with a loopback server; m2 no overall deadline without a signal (trickling body pending 45 s, ContentLength-only cap); m3 `expiresAt` overstated by up to 999 ms (SDK floors X-Amz-Date) + int test ttl 1 s flakes ~1-3 %; m4 AWS shapes unmapped (400 RequestTimeout, 409 ConditionalRequestConflict); m5 nothing logs the failure class, composition-test log assertion vacuous; m6 SPK-05 routes the putIfAbsent/F-10 rule to TASK-021, real owner TASK-116 (AC names none of it) and storage not exposed via RuntimeServices/`@platform/api/runtime`; m7 boundary.test misses lib-storage/s3-presigned-post/@smithy signer and is the only control (no ESLint entry owner).
- NIT n1: DECISIONS.md D-SEC-PR20-02 lost its Reversibility line (new decisions inserted above it).
- Union with PR #24 (3 conflicts: services.ts, services.test.ts, health.int.test.ts): new `readinessChecks(database, audit, valkey, objectStorage)`; drop the `pendingCheck` import in services.ts and in health.int.test.ts; use PR #24 `AUDIT_STAND_INS` (its `pendingCheck` now throws for audit components); fix the auto-merged old-order calls in services.test.ts. Verified on a scratch merge tree (54 unit tests).
- Merge needs: security record on the final head, fresh lane-B evidence per D-ORCH-034 (dev integration run was on 247fe29; later merge brought non-docs PR #25 files), SQUASH.
- r2 = delta: check m1-m4 tests (loopback server), `expiresAt` floor, boundary regex widening, DECISIONS repair, TASK-116 AC line, and the union commit.

## PR #26 (TASK-032 standard-columns Prisma extension) r1 AWN at 84b70c4 (2026-11-13)
- Review: `docs/05-quality/reviews/PR-0026-TASK-032-code-review.md`. No BLOCKER/MAJOR. In-PR asks: **m1** `runtime.ts:211` scopeClient wiring unpinned (mutant survives all unit; no int test stamps via createDatabaseRuntime; updates would silently skip version bump); **m3** empty catalogue / unknown model fails OPEN for forged fields (`_runtimeDataModel` is Prisma-internal); **m4** merge split D-SEC-PR20-02 from its Reversibility line in DECISIONS.md.
- Routed: **m2** relation-form `connect` on update changes server FK columns (org/onBehalf) -> TASK-037 (first tenant models; check a schema test forbids Prisma `@relation(fields:[orgId])` or org-type relation refusal); n5 typed nested-write narrowing + extension ordering -> TASK-100; n6 afterAll 5 s Testcontainer stop -> TASK-276; n8 authz re-export SYSTEM_ACTOR_ID -> TASK-020; n7 §7.6 wording -> architect.
- PR #24 union: DbErrorReason 3-member union; runtime.ts keep runStartupAuditPartitionsCheck + `RuntimeDatabaseClient extends …, ExtendableClient`. catalog-std checked by hand vs PR #24 10-audit.sql: green either order.
- r2 = delta: m1 test (fake Client ctor recording $extends), m3 throws, DECISIONS order; security record on final head; lane-B evidence if PR #28 merged first.

**PR #31 r1 AWN (2026-11-13, head 69a997c, quality staleness + scrub + pending gate).** Open for devops/security:
- M1: `scrubPaths` prefix replace has no boundary (`C:\Users\Alice` eats the start of `AliceXavier`, leaving `xavier`). M3: belt `NAME` stops at whitespace (`Jane Doe`).
- M2: `check-evidence --profile gate` reaches all three checkpoints, but `gate` is also the `v0.1.0-m0` regression profile, so a G3-checkpoint pending entry (SEC-TC-22) fails at the tag unless a `D-` decision is recorded. Track before the M0 tag.
- Merge needs a PR-0031 security record (CODEOWNED tools/quality). Any later tools/quality push voids the lane-B run (bound to 4f6a6c3).
- Technique: mutate `convert.mjs` in the archive copy per behaviour and run only `convert.test`; two survivors (env list, jestToCases classname) were redundant, not holes.

**PR #30 r2 (2026-11-13, head 5f45a8b) APPROVED_WITH_NITS.** All r1 MINORs closed with mutation-proof tests (14/14 mutants killed). Open: n2 (key/metadata validation, route TASK-147), n5 (Jest "did not exit" in services.composition solo), R2-n3 (InvalidDigest/XAmzContentSHA256Mismatch UNEXPECTED). Architect wording owed: ADR-0021 am.2 items 3/4 + WAVE-03.md:649 + plan-data.mjs (TASK-116) say `head().sha256`; should be `head().checksumSha256` (store-verified) or `get().sha256`. Union with PR #20 (Pino): composition test asserts `time`/`event` keys, PR #20 emits `timestamp`/`message`; main.ts must keep `secrets` arg. DECISIONS.md tail conflicts with main on every merge (keep both). Lane A on a head whose Lane B evidence step fails SKIPS lint/format/typecheck/unit/build: re-run them yourself.

**PR #20 r4 (2026-11-13, head 3f585b7) APPROVED_WITH_NITS.** Second-merger union with #24/#26/#30/#27 verified by merge-tree (15 files differ, all declared). Open: R4-m1 (SEC-18 relative-growth test, limit 20, linear ratio 9-15, hit 20.7 once under 7-way load; raise to 40 only in a later PR since a non-docs change stales lane B evidence 5e6ccb7), R4-n1 (record name keys header/field/k not covered), R4-n2, R4-n3; R3-n2/n3/n4 routed to the security delta round. Merge: security record on 3f585b7, no non-docs commit or non-docs main merge before squash; PR #32 merges after.

## PR #32 (TASK-020 defineRoute + pipeline skeleton) r1 CR at fa67aca (2026-11-13)
- Review: `docs/05-quality/reviews/PR-0032-TASK-020-code-review.md`. ONE MAJOR: **M1** the SHEET-FOLD-4 line "ESLint boundary for the S3 SDK" (D-ARCH-097 (6), PR30-SEC-08 (e)) is unmet; the PR body called it optional. Fix = RESTRICTED_IMPORT_PATTERNS entry + `restrictedImportsExcept` for platform/storage + fixture. All current @aws-sdk importers are already in platform/storage.
- MINORs: m1 SEC-TC-29 (execute `send` lets handler headers override private,no-store; problem handler substring-checks `private`; the helper uses x-permission!=public, the app uses auth!=anonymous, and getQuote/streamQuoteResults are public+quoteToken); m2 mountRoutes takes spread-forged descriptors (needs a WeakSet brand); m3 audit/idempotency stubs fail open (should refuse at mount time); m4 T-83 never sees defineRoute handlers (only withTenantTx call passes a reference); m5 R3-m1 residual (non-capturing `(?:v1|v2)`, `v[12]`, top-level `|` regex mounts fail open; ask for a lint ban); m6 §15 sub-rules (x-permission-status proposed; reauth max-age/ReauthProof/REAUTH_REQUIRED); m7 RouteAuth single-valued vs contract alternatives (architect, TASK-052/091); m8 closed-schema check is top level only.
- D-TASK020-03 ruled sound (stricter than the sheet's one-way (c)). D-TASK020-05 is an acceptable interim until the architect's Prisma client ruling and the first tenant route.
- **PR #20 merges first (D-ORCH-044); PR #32 does the union.** merge-tree has 5 conflicts (app.ts, main.ts, runtime-seams.api.test, contract-validation.api.test, modify/delete tools/openapi/api-mounts.ts). The clean auto-merges also break: `tests/generated/api-mounts.ts:26` and `pipeline.test.ts:31` loggers need `debug`; PR #20's `logging.api.test.ts` uses `healthRouter`/`router:` and raw supertest (the one new-rule finding). Steps are in review §6 a-h.
- r2 = delta: M1 fixture, m1-m6 (in-PR) or sheet lines, the union commit, the security record on the final head, lane-B evidence after the union.
- **r2 at 11530cc (2026-11-13): APPROVED_WITH_NITS**, 0 MAJOR. Unions #20 (4789de8) and #33 (531a244) verified by merge-tree; 22/26 mutants killed. Open: R2-m1 `.prefs/.options({allowUnknown:true})` and `Joi.link` pass the closed-schema walk (in-PR or TASK-100); R2-m2 checkRouteMetadata wiring of transaction/permission-status/reauth unpinned (in-PR or 020-C); R2-m3 T-83 misses `defineRoute(nonLiteral)`, wrapper-param handlers, `ctx.deps.queue` (020-C); R2-m4 refresh cookie is Path=/ (ADR-0006 R-06) yet counts as a presented credential: stub 401s [anonymous] routes; real authn must ignore it (architect + TASK-052/055/027). NITs: shallow freeze of descriptor audit, stale storage boundary.test comment, principalOf unknown-credential test. Merge: lane-B evidence (Docker hung D-ORCH-049) + lane A with steps actually executed (all skipped on 11530cc), security record on final head.

## PR #33 (TASK-015 015-A: US-006 coverage gate, oasdiff, CODEOWNERS/bootstrap immutability, gitleaks baseline) r1 CR at 3ed0484 (2026-11-13)
- Review: `docs/05-quality/reviews/PR-0033-TASK-015-code-review.md`. 3 MAJOR, 5 MINOR, 3 NIT; 33/35 mutants killed. Round 2 = delta.
- **M1** oasdiff container `--user 65534 --cap-drop ALL` reads a `mkdtemp` (0700, runner-owned) mount: expect EACCES on ubuntu; int test ran only on Windows Docker; step has never run in CI (skipped behind red record step). **M2** record search is merge-base..head, compare is vs tag, step unconditional: one sanctioned break fails every later PR until next tag (probed); tag pick `vnext` beats `v0.1.0-m0`; operationId substring match. **M3** coverage gate scopes `packages/ledger` but TEST-STRATEGY section 8 / D-QA-003 want `apps/api/src/modules/payments/service/**`, `packages/shared/src/money/**`, `apps/api/src/modules/ledger/**` (95/95); no task owns it.
- MINOR: m1 heavy.mjs:703 wiring line deletable (survivor); m2 new gate pins are tripwires (`|| true`, step env `GATE_OPENAPI_BREAKING=./x`, porcelain moved before lint all pass policy; lane-B evidence pin is exact); m3 deferral lists omit PR31-SEC-03/-05/N1/N2 + RustFS digest in suite-runners.json (D-ARCH-098 (6), due before Wave-0-exit activation PR but 015-C says G3); m4 heavy judges `unit` coverage only vs "merged" in section 8; m5 `npm $FLAGS exec` expansion passes.
- Merge conditions: fresh lane-B evidence (main now carries #26/#30 non-docs: 51 stale paths on a real merge), PR-0033 security record on final head, first real run of openapi-breaking step in lane A.
- Second-merger/main interplay: merge-tree with main clean; tools/ci+repo+quality 970 tests green on the merge tree.
- **r2 at d3a46a2 (2026-11-13): APPROVED_WITH_NITS**, 0 MAJOR. All r1 MAJOR/minors closed and mutation-proven (31/32 killed, 1 equivalent); smoke ran on ubuntu in lane A. Open (route 015-C): R2-m1 `gate-env` rule polices `env:` only, a head step writing `GATE_*` to `$GITHUB_ENV` passes (overclaimed wording); NITs: oasdiff image bump is red on its own PR (base-ref constant; document procedure), stale-branch-across-tag false ERR, api/README s18 lacks Accepted/persistence sentence. Merge conds: PR-0033 security record on final head; any code/workflow commit needs fresh evidence. Disk-full on host caused check-evidence.test false failures (git copy-fd ENOSPC): re-ran `check-evidence` CLI instead.
- 015-B/015-C pending owners: PR31-SEC-01..05, M1/M3 scrub, M2 `--checkpoint` before v0.1.0-m0 tag, tree-modes check, temp-cleanup test, gitleaks-full runner (extract baseline from base/gate ref, ancestry not --all), coverage:diff hook + merged coverage run, PR10-SEC-16..21, PR17-SEC-02/07/08/10.

## PR #34 (TASK-276 test harness) r1 CR at 4643265 and PR #35 (TASK-277 trace tooling) r1 AWN at 76808c8 (2026-11-13)
- Reviews: `docs/05-quality/reviews/PR-0034-TASK-276-code-review.md`, `PR-0035-TASK-277-code-review.md`. Lane B / Docker not run (D-ORCH-049): `prisma/tests/db/query-counter.int.test.ts` still has to execute.
- **#34 MAJORs:** M1 `generated` project folder rule (`**/tests/generated/**/*.test`) pulls PR #32's lane-A `route-metadata.test.ts` / `contract-drift.test.ts` out of `unit` (lane A runs only `test:unit`); fix = unit stops ignoring the folder, `generated` matches only `*.{api,int}.test`. M2 `useLeakageGuard` afterEach body is a surviving mutant (inject `register`). M3 base64 needle only for offset 0 (JSON/JWT/Basic miss).
- #34 MINORs: partial log line unscanned, key echoed into finding path, `cause`/Uint8Array/toJSON/depth fail-open, heavy.mjs JEST_PROJECTS lacks `generated` (D-TASK276-01 vs -02 contradict; owner TASK-033), query-counter has no prod-mount tripwire, factories identity per worker not per file under `-i`, fake clock has no auto-restore.
- #34 vs #32 union: only `tools/repo/jest-esm.test.ts` script list conflicts (add test:contract + test:generated); jest.config/package.json auto-merge. #34 + #35 merge clean.
- **#35 no MAJOR.** KNOWN_DRIFT pin accepted with owner/date (PM+qa-lead; append-only fix moves inserted scenarios to the end of each block, no test renumbering). MINORs: `covered` zero-test guard mutant survives; NFR counting omits FULL rows with partial parts (4 rows vs 1); default `--out` inside the run dir; D-TASK277-03 premise wrong (`ac-trace.json`/`flake-report.json` ARE in FIXED_RUN_FILES; the missing piece is the summary.json attachment hook in heavy.mjs, owner 015-B/C before G3); malformed IDs invisible; Must-AC denominator understated by 13 while drifted.
- When #34 r2 / #35 r2 / TASK-033/278 land: re-run `--listTests` per project on the union; check heavy.mjs `generated` support; check KNOWN_DRIFT emptied.
- #34 status as of 2026-11-14: r2 AWN at 3934d12; union re-check APPROVED at 2e5e16f (merged with main after #32 and #37). Merge conditions: security record naming 2e5e16f, then green scans and ci-gate. Nits R2-m1/m2 (fake-clock restore assert, test-seams walk) and R2-n1..n3 are routed to the next touch of tests/helpers (T-QA-05 redaction activation or the API test app builder).
- Lesson from the #32 union: PR #32 removed SYSTEM delegates from TenantDb (PR19-SEC-01). Any branch older than #32 that reads `tenantDb.<systemModel>` inside withTenantTx type-checks only on its own base; after the union it must use `systemDelegates(tx)`. Grep for this whenever you review a union with #32.

## PR #38 (TASK-020 part 020-B) r1 CR at bdf009d (2026-11-14)
- Review: `docs/05-quality/reviews/PR-0038-TASK-020B-code-review.md`. ONE MAJOR: **R1-M1** commit 5aafb2c deleted the `[R2-n1] [PR32-SEC-15] deep-frozen` describe from define-route.test.ts; mutant `audit: spec.audit` survives 118 routing tests. Fix = restore main's block (passes on head). Rides the #34 union commit (D-ORCH-054).
- MINORs: m1 problem handler trusts `markCredentialsRead` (documented "before reading a header" order gives 401 `no-store` not private; fix = declared test from the route descriptor); m2 DB_CONNECTION_TIMEOUT_MS <2000 -> exit 1 at boot (route config min 2000); m3 vacuous `not.toEqual(arrayContaining)` in runner-activation.int.test; m4 unlocked static import of generated client vs deps:rebuild regeneration; m5 two-hop via module `tests/` helper (security); m6 credentials.ts not CODEOWNED (security).
- r2 checklist: block restored; union keeps BOTH db-root-client [client.ts, generated.ts] and the db-test-seam line; seam pair last; generated-value pair right after DATABASE_CODE allow; tools/tsconfig include has no prisma/generated; fresh evidence; security record on final head.
- **r2 AWN at 8b3a8ed (code cdd3716, 2026-11-14).** Union 976edf6 pure (merge-tree diff = conflict markers only); R1-M1/m1/m2/m3/m6/n1 + PR38-SEC-01/-02 closed, 11/11 mutants killed. R1-m1 design: handler = private mark || declaresPrivateResponse(branded descriptor) || (!credentialsRead && generic); config floor DB_CONNECTION_TIMEOUT_MS_MIN=2000 parity-pinned to DEFAULT_MAX_WAIT_MS. New NITs: R2-n1 forged descriptor + credentialsRead -> only mark decides (JSDoc overclaims; fail-closed one-liner); R2-n2 problem-handler.api first test hit 5 s cold in combined run (loopback constant only in 2 files). Merge: security delta record naming 8b3a8ed+, no non-docs commit, squash.
- When 020-C / TASK-052 lands: check R2-n1, R1-m5 policy placed BEFORE the seam pair, and that real authenticators use `declaresPrivateResponse`.

## PR #40 (TASK-015 merged-coverage hook, D-ORCH-047) r1 CR at 2b651f7 (2026-11-14)
- Review: `docs/05-quality/reviews/PR-0040-TASK-015-covhook-code-review.md`. ONE MAJOR: **R1-M1** branch merge over-reports PERCENTAGE (phantom covered key from V8 adjacent-equal-count coalescing in one run; uncovered count stays equal, which is all the PR's validation checked). Real-Jest proof: m5 shape merged 6/8=75.00% vs combined 5/7=71.42%. Fix = range-tree merge (port @bcoe mergeFunctionCovs, keep interior-line cap) or a decision relaxing to "uncovered never fewer" + real-Jest fixture triples test.
- MINORs: m1 projectProblems per source (grouped unit+unit-dom / integration+api: a 0-test project passes "measured"); m2 coverage-only run failure path untested (H3 `bad>0`, H7 `status!==0` survive); m3 TEST-STRATEGY 8 row 1 says Lane A diff gate, PR does lane B pr; m4 required_cases only overall+authz (audit names at TASK-025) + nameHasId substring match (ask classname===suite).
- Union: PR #38 first; only package.json scripts overlap (clean). r2 = rerun scratchpad differential (drive.mjs/show.mjs/m5.js kept in review/PR-40-cr), m1/m2 tests, fresh evidence on union.
- **r2 AWN at e8f4461 (code 08637c8, 2026-11-14).** R1-M1 closed: `tools/ci/v8-range-tree.mjs` port = @bcoe 0.2.3 (0 diffs / 5,000); `coverage-merge-probe.mjs --seed N --trials K` then `--report` (seeds 4711/90210: 0/59 above). NEW **R2-m1** MINOR: targeted TS shapes (one-line `if…return`, for-of continue/break, async try/finally, `??`/`?.`) gave 3/42 ABOVE combined (+1..2 covered) via source-map uncross pieces; uncovered-never-fewer held 133/133 -> amend D-TASK015-22/28 + header, pin cases, qa-lead whole-repo merged-vs-combined at G3. **R2-m2** under-report up to -7.5 pp/TS file; fixture "<=2 fewer / >=20 equal" is seed-40-fitted. NITs: split/pending paths unpinned (T4/T7/T11 survive; dead after uncrossSpans), "ran" counts skipped files. Scratch scripts were session-only (not kept); reproduction in record R2-m1 detail.
- When TASK-025 (PR #42) lands on the hook: a borderline packages/audit 95 % branch result may be R2-m2 under-report; cross-check with one combined run before calling it a gap.

## PR #39 (TASK-014 images + Compose) r1 CR at 894c72e (2026-11-14)
- Review: `docs/05-quality/reviews/PR-0039-TASK-014-code-review.md`. ONE MAJOR: **R1-M1** D-ARCH-115 merge check (sheet line 545): image find lacks `*/routing/tests*` (+ generic `*/dist/*/tests/*`), prune-dist.test lacks routing case. Risk nil (dockerignore `**/tests`, prune dir rule, preflight cleanTree over app + @platform dep dists) but literal merge check; fix + targeted `test:stack -- tests/compose/images -t "sheet line 543"` re-run.
- MINORs: m1 entrypoint.sh `exec node ... "$@"` forwards CMD args unchecked (`--inspect` via command override); m2 dependabot.yml says docker ecosystem comes with TASK-014, not added (9 digest pins; node+debian must move together; sec-static.test.ts:149 cooldown count); m3 docs-drift ruling (architect amendment pass for dist/healthcheck.js, npm exec prisma; CLAUDE.md §2 run-locally stale: api :3000/admin :8081 vs edge 8080/8443/8444); m4 stack 45/45 only claimed in PR body, worker 296/300 MiB checked only in opt-in suite.
- Verified: per-project `--listTests` identical with/without JEST_STACK=1, no file in two projects; #39+#40 merge-tree clean (397fc4f); config predicate vs tlsConfig 350-case differential 0 fail-open.
- r2 = delta: R1-M1 diff, stack re-run statement with head SHA, security record on final head, merge main (docs-only).
- **r2 AWN at c85d5e5 (code 4d87301, 2026-11-14).** R1-M1/C1, architect R1-R6, R1-m1/m2/m4, n2/n3/n5-n9 closed; D-TASK014-24 exit-78 now in `installProcessErrorHandlers` (configErrorVariable), entry points equal main; 11 merges pure (2 hand resolutions in check-workflow-policy keep SEC-05 + PR43-SEC-04 + PR40-SEC-01). NITs: R2-n1 find misses `dist/tests/*` directly + no `*.test.ts` (tooling ships src); R2-n2 stale "exit 1" comments (start-api.ts, worker main, config-exit JSDoc) -> 020-D; R2-n3 in-process CLI test positive-only; R2-n4 body lacks 545 row; R1-n4 TLS parity has no owner.
- **#42 union (second merger):** GUARDS.length 15; keep `'PGOPTIONS'` variable arg; pass `'DB_TENANT_ADMISSION_WAIT_MS'` on the admission TenantTxConfigError + configErrorVariable row; images already ship packages/audit; worker 98.7 % -> re-run test:stack size cases; ONE heap line. #46: one heap line, lint `run` unchanged. #45: retire dd7a2dd entry after squash.

## PR #42 (TASK-025 audit writer core + admission bulkhead) r1 CR at e7dfbac (2026-11-14)
- Review: `docs/05-quality/reviews/PR-0042-TASK-025-code-review.md`. ONE MAJOR: **R1-M1** `createPrismaAuditStore` (append = unvalidated row, insertVaultRows) exported from the `@platform/audit` root escapes `platform/audit-writer-allowlist` (default writerExports AuditWriter/createAuditWriter/writeAuditEntry; Linter probe on a module-service filename). Fix: rule option or `@platform/audit/store` subpath + fixtures.
- MINORs: m1 setter-exemption pin `/set_config\(/` misses space/case/newline/bound-key (rule FORMS probe); m2 validate-then-use across tokeniser await (forged `$pii`, NUL, Date→{} after prepare); m3 lone surrogate → client-triggerable 500 (Joi accepts, pg stores U+FFFD; fix toWellFormed in snapshot); m4 two write() per tx breaks ≤2 RT under lock + vault-wait deadlock window (route architect/TASK-029/030: writeAll); m5 AT-US-087-04/07/08 unrouted.
- Verified: pinned vector byte-identical to spk04 chain.test; 30/34 mutants killed (S4/T3/T4 equivalent, N3 = m2 path). Unions clean with #40/#41/#43/main; #39: values.test GUARDS 15 + TenantTxConfigError `variable` for admission keys; images must ship packages/audit.
- r2 = delta: M1 config + fixtures, m1 pin + mutation, m2 snapshot test, m3 decision, #40 union with merged packages/audit uncovered branch COUNT ≤ 4 (not pct), security record on final head.
- **r2 CR at d2ef478 (code 7af2ef8, 2026-11-14).** All r1 items closed (21/26 mutants; latch 7/7; wellFormed = toWellFormed over 299,593 strings; merges pure; audit 1413/1413, 433/433). NEW **R2-M1**: `apps/api/src/platform/audit/writer.ts` `auditWriterFromConfig` (the R1-n5 fix) re-exports the writer from an allow-listed folder; a module importing it is lint-clean (probe p7). Fix = resolved-file boundaries policy (or a normalised-specifier rule arm) + fixtures.
  - R2-m1: client-shapeable `uaParsed`/`entityId` give 500 -> TASK-029 AC or null instead of refuse.
  - NITs: n1 `roles()` uses the caller's `map` (own map/length flip); n2 setter pin lexical strip hidden by `'/*'`…`'*/'` (P3; count over raw source); n3 brand untested (N8).
  - r3 = delta: p7 probe (scratchpad `review/PR-42-cr2-lintprobe.mjs`), new fixtures + mutant, security record on final head. Scripts: `review/PR-42-cr2-mutate.mjs`, `review/PR-42-cr2-probe-toctou.mts`.
- **r3 AWN at 96bd37a (code 6e3ec99, 2026-11-14).** R2-M1 closed (boundaries policy on resolved file, eslint.config.mjs:597-602; 25 probe shapes reported; policy mutants 7/10, G/I survive). PR42-SEC-13 track/settle sound (10/12; T9 equivalent, T11 throw-path design). 5 merges pure; #44 union keeps both row sets. D-TASK025-29 lint heap accepted (#46 converged on identical line; comment-only ci.yml conflict).
  - OPEN: **R3-m1** MINOR: JSDoc (tenant-db.ts:71) endorses `void writer.write()`, but the async `write` returns an unhandled promise; a failing voided write -> `unhandledRejection` -> api `crash()` (process-errors.ts:88). Fix = mark returned promise handled + test, or JSDoc now + TASK-029 AC. R3-n1 add capture.ts negative fixture (kills G/I). R3-n2 two-hop re-export via platform/db etc. clean (record in D-TASK025-22). R3-n3 `static-module-specifier` crashes on TS `import x = require()` (module-sources.mjs:80, main/020-D).
  - Merge: security r3 record on 96bd37a+; #46 second-merger keeps one heap line; #39 items unchanged; squash. Scripts kept: `review/PR-42-cr3-{lintprobe,mutate-lint,mutate}.mjs`.

## PR #43 (TASK-024 RLS generator, DR-A14, C15, linter 11c/17/18/19) r1 CR at 8ac271d (2026-11-14)
- Review: `docs/05-quality/reviews/PR-0043-TASK-024-code-review.md`. 43/43 mutants killed (generator, linter, sql-text, render, up-down-up).
- **R1-M1** splitStatements BEGIN/CASE depth (sql-text.ts:170-209) counts `begin` at any paren depth without ATOMIC: param `f(begin int)`, `RETURNS TABLE(begin …)`, fn `public.begin()` swallow the rest of the file (rules 2/8/9/11/11c/14/17 silent); `END;` resyncs so EOF check alone is insufficient. Fix = BEGIN ATOMIC only at paren depth 0 + fail closed at EOF + fixtures.
- **R1-M2** API enumeration excludes `guest` tenancy (getQuote/streamQuoteResults) and `API_CASES` is a bare operationId Set (no executed probe). Fix = include guest + Map of executable cases (or bind to executed rbac-matrix rows).
- MINORs: m1 rule 11 `^select` anchor misses WITH/VALUES set_config('lock_timeout'); m2 `EXECUTE function;` bypasses DYNAMIC_EXECUTE lookahead (catalog backstops); m3 probe.ts DR_A14_DDL all-or-nothing -> 42P07 at TASK-037 (orgs+memberships land, users not); m4 C1/C2/C3/generator public-only (card asked non-system schemas); m5 suite in no lane, PR text wrong (generated IS in heavy JEST_PROJECTS; missing suite-runners entry); m6 cost/guard-share json in git-ignored reports/, no observer.
- r2 = delta: rerun probes in scratchpad review/PR-43-cr (probe1/2/3.mts, mutate*.mjs), check TASK-037 card line for probe.ts.
- **r2 AWN at 585f163 (code 9d679f0)**: R1-M1/M2 fixed; 32/35 mutants (s2 paren gate unpinned; s7/s10 equivalent); 55 repo SQL files split identically main/r1/head. OPEN: **R2-m1** `AS case`/`t.case` (reserved ColLabel/attr_name) in a BEGIN ATOMIC body + later top-level `END;` resyncs depth and hides statements (lint clean) -> skip case/end after `as` or `.`; fix in-PR or route before first BEGIN ATOMIC migration. n1 s2 pin; n2 API runner cross-direction pairs (session->G, guest H->B), header leaks, no unit test (fake http server works, probe6.mts); n3 describe date. Activation deviation accepted (rule 4; generated already runs in lane B merged coverage); manifest-only PR before TASK-037. #39 union: textual conflict in check-workflow-policy .mjs/.test (keep both describe blocks whole).

## PR #44 (TASK-020 020-C route I/O phases, T-83 residuals, D-ARCH-113/114) r1 CR at 9def3f5 (2026-11-14)
- Review: `docs/05-quality/reviews/PR-0044-TASK-020C-code-review.md`. 22/28 mutants killed. ONE MAJOR: **R1-M1** `execute.ts` awaits `call`/`stream.complete` bare; the 20 s deadline only aborts a signal (probe: never-settling call pending > 2 s at 50 ms deadline), contrary to the JSDoc "cannot outlive the stop window"; `AbortSignal.timeout` reason (DOMException) maps to 500. Fix = race against the signal + AppError reason, or architect "advisory" ruling (then MINOR).
- MINORs: m1 `requestSignal` registered lazily at `call` (disconnect during load never seen); m2 body+stream check after COMMIT (commit then 500); m3 main.ts afterCommit wiring unpinned (M1/M2 survive; extend entry-points.test); m4 queue no cap, no signal for afterCommit; m5 T-83 silent on spread-supplied phases and const-conditional aliases; m6 `moduleSourceVisitor` misses `createRequire(u)(x)` so the D-ARCH-114 comment's "covered by prisma-client-construction" is false (fix in-PR or 020-D).
- Rulings: D-TASK020-56 accepted (pin walk, R1-n1); D-TASK020-61 settled by D-ORCH-067. PR #38 R1-m5 two-hop via tests/ still open (security).
- Unions: #42 clean (readOnly inside admission-wrapped transaction()); #43 trips the idle ratchet at cross-tenant.int.test.ts:398 (switch to TEST_LANE constant + Docker run). Main has #40 non-docs -> fresh evidence if merged.
- r2 = delta: re-run P1/P2/P3 loopback probes, mutants M1/M2/D3/E10, lint probes Q1/Q2 and createRequire p1/p3/p7/p8.
- **r2 AWN at d943ef7 (code 035687c, 2026-11-14).** R1-M1 closed (P1 503+Retry-After 157 ms, no begin:rw even for late-resolving abandoned calls); all r1 items closed; r1 M1/M2/D3/E10 killed; 31/40 new mutants (5 equivalent, 3 timer hygiene); 4 merges = clean merge-tree; start-api.ts entry refactor executes real shutdown, no coverage exclusion. NEW MINORs (in-PR or 020-D): **R2-m1** pre-slot `res.closed||res.destroyed` guard unpinned (E3; probe P7 = hold etag slot, abort client); **R2-m2** template-literal key `nm[\`createRequire\`](u)(G)` / `{ [\`createRequire\`]: mk } = nm` -> zero findings in worker platform/db (isCreateRequire matches Literal only); **R2-m3** T-83 `enclosingFunction` crashes ESLint (Program.parent null) on a module-level holder alias used in a root. NITs: timer hygiene, call+afterCommit > 25 s drain composite, destructured-method/factory-alias residuals, raiseStartupError origin field. Merge: security record on final head; do NOT merge main 48f50e0 (.claude files stale evidence); squash. #39 second: `createOrExitOnConfigError(() => deps.createRuntimeServices(...))` in start-api.ts + exit-78 test; #42: keep both negative-fixtures row sets.

## PR #45 (gitleaks commit-bound allow-list for PR #39 dd7a2dd, D-ORCH-068) r1 AWN at 66ae5c1 (2026-11-14)
- Review: `docs/05-quality/reviews/PR-0045-gitleaks-allow-code-review.md`. Entry correct: regexes match only lines 272/273 of the file at dd7a2dd; 756d505 removes the values.
- MINORs: m1 regex sources pinned by count only (value-class widening and a `(?:.*)$` tail on line 273 survive; fix = exact toEqual of the two value-free sources); m2 `allowedBy` oracle requires paths/regexes (gitleaks skips absent checks); m3 no retirement trigger (repo squash-merges; entry dead once PR #39 squashes, permanent if merge-commit).
- Follow-up when PR #39 merges: check the entry was removed (squash) or kept (merge commit) and the description pin updated.

## PR #46 (TASK-015 015-B: lane C, nightly, security-integration, C-1, ci:minutes, SPK-07, gitleaks-full) r1 CR at 12ea6a6 (2026-11-14)
- Review: `docs/05-quality/reviews/PR-0046-TASK-015B-code-review.md`. ONE MAJOR **M1**: inventory `jestFileCounts` dedups by file+fullName, collapsing same-named tests in ONE file; lane B JUnit keeps them -> false `lower-count` on same-code runs (unit.junit has 3 dup pairs; merged branches stay on origin so same_code is reachable). Fix = max multiplicity per report.
- MINORs: m1 security-integration step/if/ci-gate aggregate unpinned in base-ref policy (`--dry-run`, accept-failure, `-z` head manifests all pass); m2 gitleaks-full config/baseline-from-`--ref` unpinned (G5/G6); m3 Playwright redirect via `npm_config_*`/`npm_package_config_*`; m4 CI retries hide flakes from COND-E2E-FF (ask `--fail-on-flaky-tests`); m5 lane B gitleaks reads host `.git/info/attributes` (ask `--text --no-textconv --no-ext-diff`); m6 inventory since/sameCode untested, wave-end without since narrows silently; m7 SPK-07 forecast omits security-integration (≈100 % by Nov 30).
- Minutes recommendation given: label-gated `merge-candidate` run read from payload, no `labeled` trigger type, ci-gate rule unchanged (fail closed). D-ORCH-077 says architect rules + fix cycle before merge.
- r2 = delta: re-run 37-mutant table (scratch mut.mjs recipe: archive + junction + `git init`/commit in the copy for sameCode tests); check label pin if adopted.
- **r2 CR at ad30316 (code 6e94ba4, 2026-11-15).** All r1 items closed (31 r1 mutants + 57/67 new killed; unions ed67a98/814c5bf pure; heap line == #42/#39, comment-only conflict). ONE MAJOR **R2-M1**: lane-scope `lookupProofs` accepts code/security proofs from any ci.yml pull_request run on an identical commit regardless of base; PR into writer-controlled `weak` forges fast-lane/scans step names -> ci-gate MERGE-READY with nothing run. Fix = bind to head_branch + single never-retargeted PR into main + `pull_request.branches: [main]` pin + D-ORCH no-retarget; or architect/security residual ruling (then MINOR). R2-m1 `gateInputFromEnv.thisRunCodeProblems` untested (L10/L10b survive). R2-m2 devOptional (prisma CLI/engines) counted dev (route architect; do not adopt D-TASK015-59 root refinement first). NITs L1/L12/L14/L20/L21/L27/P10.
  - r3 = delta: re-run scratch `review/PR-46-cr/mut2.mjs` (98 mutants; paths before --selectProjects; session scratch may be gone, table in record R2.4) + R2-M1 binding mutants.
- **r3 AWN at 4bbce92 (code 0f17495, 2026-11-15).** R2-M1 closed (proofBinding: pulls state=all count==1 + run head_branch/head_repo/pull_requests==[this PR, base main] + created > last base_ref_changed; fail closed). D-TASK015-65 (no base.sha ancestry) accepted. Binding mutants B01-B28/WB1-10/PB1-3 killed except **R3-n1** B27 (`sameRepo` null repo -> true untested). **R3-n2** binding never ran live (no completed run on identical SHAs in 43687170281): security-record docs push is first exercise; if issue-events needs `issues: read`, every docs push fails closed. **R3-n3** INFO: retarget cutoff relies on base_ref_changed in issue events + API consistency (security residual). L10/L10b, L1/L12/L14/L20/L21/L27/P10 killed. Unions pure (one heap line, main comment, no spikes). #39 forward merge-tree (b66c026) clean, pins kept. Script `review/PR-46-cr/mut3.mjs` (DRY=1 env = anchor check only).

## PR #47 (qa-lead manifest-only rls-cross-tenant activation) r1 AWN at be8780b (2026-11-14)
- R1-m1 SEC-TC-74 parked in `required_cases_pending` although 16 passing catalog cases carry it (deletion passes lane A while parked; Wave-0-exit `wave` run FAILs rule 7). Routed to security-analyst (D-QA-018). Re-check: moved to `catalog-c1-c14.required_cases` before TASK-037 merges.
- R1-n1 heavy.mjs summary does not record `--base` (015-C). R1-n2 merged branch denominator path-dependent (4201/4193/4188 on same source; qa-lead/015-C). R1-n3 PR34-SEC-05 drop `--passWithNoTests` from `test:generated` unlisted (next activation PR).
- Merge order: #47 before #42 fc2 evidence (else #47 credited unit run lacks `coverage gate: packages/audit lines|branches`). After #47, every backend PR's run needs rls-cross-tenant >=126 with [SEC-TC-06].

## PR #48 (TASK-027 RBAC matrix generator, US-071, SEC-TC-01, PR43-SEC-12, R2-n2) r1 AWN at a4f2d51 (2026-11-15)
- Review: `docs/05-quality/reviews/PR-0048-TASK-027-code-review.md`. Generator 31/35 killed (D6/O3/O6 equivalent, D8 no-op); slot probe P3/P3b/P6/P7/P8 killed, P1/P2/P4/P5 survive (seam pre-filters declared kinds; covered by authorise.test.ts).
- OPEN: R1-m1 runner.ts:176-184 Cache-Control/foreign checks have no negative control (work: P6 1,748 problems); R1-m2 matrix never reaches authorise credential/actor gates, D-ARCH-110 title overclaims; R1-m3 seam retirement in no card (TASK-052/055/091/171/261/MFA/041 grep 0); R1-m4 observe() no per-request deadline, transport error aborts 900 s test unnamed (add to TASK-W0-FLAKE).
- Merge: MC1 union with main after PR #39 (clean, tree b568ee6) + fresh lane-B evidence; MC2 security record; activation PR (D-ORCH-092) adds CODEOWNERS /tests/generated/rbac/.
- r2 = delta: re-run scratch `review/PR-48-cr/probe-slots.mts` (tsx, swaps PipelineSlots, args: worktree + variant names) and `mutate-gen.mjs` (needs archive copy + junctions; unit lane only).

## PR #52 (TASK-285 audit actions v2, 91-audit-actions-v2.sql) r1 AWN at a718dcd (2026-11-15)
- Review: `docs/05-quality/reviews/PR-0052-TASK-285-code-review.md`. 10/14 mutants killed (K2 lookahead + P2 comment fixture survive; P3 equivalent; S4 no-SET-ROLE killed only in integration). Name 91- forced (runner + `bootstrap/added-out-of-order`); KEEP form safe (17-form probe, linear).
- OPEN: R1-m1 contract enums still 18 (D-TASK285-02 CR in no card; ADR-0007 am.11 item 4 "already lists 20" false) -> TASK-073/api-designer AC line; R1-m2 existing-DB upgrade runs on EMPTY store (add pre-upgrade LOGIN row + chain continuity). NITs n1-n3.
- Merge: security record approving blob 9945c349; do NOT merge main (.claude/agent-memory stales evidence); squash.

## PR #53 (TASK-W0-FLAKE host-load timing) r1 CR at 8a48139 (2026-11-15)
- Review: `docs/05-quality/reviews/PR-0053-W0-FLAKE-code-review.md`. TWO MAJORs, same root (deadline + 20 s slack): **M1** AT-US-012-03 (2.5 s AC) unpinned, router bound derived from READINESS_DEADLINE_MS itself (mutant R2 8 s/9 s survives head, killed by main); **M2** PR30-SEC-01 `bounded()` deadline x10 survives head (S1), main kills it. Fix = deterministic magnitude pins (static AC constants + spy AbortSignal.timeout), keep slack only for fired-vs-hung.
- MINORs: m1 heartbeat over-subtracts on Windows (-36 % idle) and subtracts own sync work entirely; m2 180 s x hang vs lane A 25-min job -> unnamed cancel; fetchOnce needs request deadline. NITs: fetchOnce ignores signal/sends chunked/sends after reject; worker slowloris 5 s unpinned; PR #48 R1-m4 unrouted.
- r2 = delta: re-run scratch `pr53/mut.mjs` (archive copy + junction; HEAD vs base test swap; rows C0/R1/R2/S1/H1) + `hb.mts` + `fo.mts` probes; worker suite resolves @platform/api via worktree symlink (mutate the worktree-independent way or skip).
- **r2 CR at 69a0d75 (code b5dc741):** R1-M1/M2 and every r1 minor/nit are closed (mutants R1/R2/R2w/R3/W10/S1/S2/S3/H1-H3 killed; fetchOnce probes OK). NEW **R2-B1 BLOCKER**: the `apps/api/package.json` export `./test-support/timing` makes the worker image preflight fail (it imports every export; dist tests/ pruned); fix = `./testing` subpath or tools/test-support + a no-Docker preflight-vs-prune regression test. R2-m1 the jitter self-test is load-sensitive. n1 the caller 300 pin is self-recorded. n2 H4 survives (main default budget) + an unrestored setTimeout spy. O-1: lane A crashes on a stale `base.sha` + head without PR #46 tools/ci (contradicts D-ORCH-102), so the union must go in the fix push. r3 = re-run V10 repro (`scratchpad/pr53/img-*`) + `mut-r2.mjs`.
- **r3 AWN at 378af72 (code 60a1659, 2026-11-15):** R2-B1 closed (`@platform/api/testing` in SKIPPED_EXPORTS per orchestrator ruling; real preflight+prune repro `cr53r3/v10.mjs`: old exit 1, new/base exit 0; new `tools/docker/image-exports.test.ts` kills re-added export). 19 rows killed (`cr53r3/mut-r3.mjs`, incl. H4, N1-N4, X1, X3). Open NITs: R3-n1 SKIPPED_EXPORTS unpinned (X2 survives); R3-n2 scan skips `prisma/` + follows only `default` condition; R3-n3 pre-existing `@platform/config/testing` lint-clean from prod and NOT pruned (flagged to security). Merge: security record on 378af72, no further main merge, squash.

## PR #54 (TASK-020 part 020-D raw-SQL ownership + PR44-SEC-05 guard) r1 CR at 3efa2df (code f01e470, 2026-11-15)
- Review: `docs/05-quality/reviews/PR-0054-TASK-020D-code-review.md`. ONE MAJOR **R1-M1**: both lexer twins (`tools/eslint-rules/raw-sql-lexer.mjs`, `apps/api/src/platform/db/raw-statement.ts`) end `--` comments only at `\n` (PG: `\n` or `\r`) and use `\s` (PG space is `[ \t\n\r\f\v]`, bytes >= 0x80 are ident chars): `SELECT 1 -- n\r; COMMIT` and `AS \u00A0$q$; COMMIT; ... \u00A0$q$` pass lint (escape forms) AND guard; PGlite executes COMMIT. Also defeats rawSystemTable.
- MINORs: R1-m1 dynamic `import('node:module')` static members unbounded (`.Module._load('pg')`, `.register`, `{default:M}` + `M[k]`) contra D-TASK020-86; R1-m2 corpus misses 2nd set_config / `EXPLAIN ANALYZE UPDATE pg_settings` (mutants survive); R1-m3 DECLARE WITH HOLD + session advisory locks not refused. NITs n1-n6 (R2-m1 test delays, `const add = deps.queue.add` alias, rawStatement not on packages/*/src, B5 allowance via TenantDb, regclass residual, TASK-283 card line).
- r2: delta review; re-run scratchpad probes (`pr54/pg-probe2.mts`, `probes3.json` via `full-probe.mjs`, `mutants.mts`, `diff-fuzz.mts`); need security record + fresh lane B.
