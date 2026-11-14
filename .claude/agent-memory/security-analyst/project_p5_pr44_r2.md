---
name: project-p5-pr44-r2
description: PR #44 (020-C) security delta round 2 @d943ef7 2026-11-14 PASS_WITH_FOLLOW-UPS; 01 MED/02/03/04 closed; new LOW 10 template-literal createRequire key (= code R2-m2, 020-D), LOW 13 AppError cause to Express stderr after headers; INFO 11 lint crashes, 12 abandoned work, 14 built-in loaders; D-SEC-PR44-02 proposed
metadata:
  type: project
---

Round 2 appended to `docs/05-quality/security/PR-0044-TASK-020C-security-review.md` in worktree `Shipqube-TASK-020` (uncommitted, LF, 852 lines; first 54,045 bytes identical to committed r1 `b947c24`). Head row `d943ef7…` (code `035687c`), owned 82 vs main, 52 changed since `9def3f5`. Code review twin r2 on main `bd67d66` = APPROVED_WITH_NITS (R2-m1 pre-slot test unpinned, R2-m2 = my 10, R2-m3 T-83 module-level alias crash).

**Verdict PASS_WITH_FOLLOW-UPS** (0 C/H/M; LOW 05, 10, 13; INFO 04 residuals, 06-09, 11, 12, 14; 08 widened to `start-api.ts`/`main.ts`/`app.ts`).
- **10 LOW:** `` m[`createRequire`] `` / `` { [`createRequire`]: c } `` zero findings (isCreateRequire/isCreateRequireKey accept `Literal` only). Rated LOW not MEDIUM (deliberate respelling, grep-visible) → 020-D, before first module/worker-job PR; interim review grep.
- **13 LOW (pre-existing since TASK-006):** `problem-handler.ts` passes the thrown `AppError` itself to `next()` after headersSent; Express 5.3.0 `logerror` = `console.error(err)` → `cause` printed unredacted. Before TASK-044.
- **11 INFO:** `nodeModuleImport` crashes on `import x = …` reads (TSImportEquals has ImportBinding, no `.source`); T-83 `enclosingFunction` null crash (R2-m3). Fail closed.
- **12 INFO:** abortable stops waiting, work keeps running; afterCommit cap counts awaited work only (500 abandoned still running at pending 0); one drop log line per item.
- **14 INFO:** `process.getBuiltinModule('<builtin>')` escapes node-path-only/T-83/SSRF; `Module`/`register` from node:module; timers `{ promises }` and dynamic import.

**Facts:** merging current main (`.claude/agent-memory/*/*.md`) does NOT stale lane-B evidence (`AGENT_MEMORY_GLOB` in main's manifest.mjs) — code review cond. 2 was stricter than the gate. Joi 18 template `functions` run during validate (same capability as `.custom()`). start-api child probe: after handlers one redacted line exit 1 (message text kept, `password`/URL password redacted); real loader exit 78 keys only; loader fault before handlers = Node default report (unchanged).

**Kit (session scratch `pr44sec-r2/`):** `lintprobe2.mjs` (crash-tolerant, messageId suffix, realpath root), `cases-n/e/m/t3.mjs`, `p-signal2.mjs` (real problemHandler), `p-preslot.mjs`, `p-stderr.mjs`, `p-queue2.mjs`, `child-start.mjs`+`p-start.mjs`+`hooks2.mjs` (maps `@platform/prisma/client` to main's generated client), `p-drain.mjs` (real timers 25 s), `record-sim2.sh` (16 scenarios + evidence on main-union).

**How to apply (next round / union):** second merger of #42 (negative-fixtures 3 row sets, tx body order incl. settle/markRollbackOnly, TENANT_CONCURRENCY_LIMIT, per-phase permit) or #39 (`createOrExitOnConfigError` into start-api.ts + worker startWorker pattern) voids the record (sim S9/S10) → merge-only/delta round against R2.8. 020-D record must close 10, 11, R2-m1 test.

Related: [[project-p5-pr44-020c]], [[project-p5-pr42-r2]], [[project-p5-pr39-task014-images]], [[project-security-review-conventions]]
