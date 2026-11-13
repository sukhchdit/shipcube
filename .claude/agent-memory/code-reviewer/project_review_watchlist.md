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
