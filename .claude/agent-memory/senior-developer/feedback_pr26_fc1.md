---
name: pr26-fc1-lessons
description: PR #26 fix cycle 1 (2026-11-13) solo ~95 calls - DECISIONS.md rebuild script, prettier --write on docs rewrites main content, commitlint range, required-dep ripple
metadata:
  type: feedback
---

PR #26 fc1 (relation-field refusal, required `scopeClient`, wiring test, fail-closed catalogue) done solo; first gate run green.

**How to apply / pitfalls:**
- **DECISIONS.md repair recipe:** `git show origin/main:docs/sdlc/DECISIONS.md > file`, then a node script appends the own blocks (Write tool script, not `node -e` with backticks). Re-run it on every main re-merge (the append-at-end conflict recurs each time main logs a decision). Proof: `git diff origin/main --stat -- DECISIONS.md` = N insertions, 0 deletions.
- **Never `prettier --write` docs/sdlc/DECISIONS.md:** it reformats main's existing entries (9 deletions). `format:check` ignores it anyway.
- **commitlint range:** `--from origin/main --to HEAD`, not from the remote branch; the latter drags in main's own sentence-case docs commits as false failures. Header max is 100 chars. Run `commitlint` via `npm exec --no -- commitlint ...` (extra `--` before `--from` triggers an npm warning only).
- **Making a deps member required** ripples into every `createWithTenantTx` caller, including integration tests under `prisma/tests/rls` (4 files); grep `createWithTenantTx` first.
- **Runtime wiring test pattern:** a recording `Client` class passed to `createDatabaseRuntime` (records `$extends`, which client opened `$transaction`) - kills the "delete the runtime.ts line" mutant. Make `$queryRaw` generic (`<T>(): Promise<T>`) or tsc rejects the class against `RawQueryClient`.
- **catalog-std `qualify`:** public-schema tables are NOT prefixed in finding text (`table.col`), other schemas are (`audit.table.col`).
- **No fix/quality-* PR existed on 2026-11-13**: lane-B evidence stayed pending (D-ORCH-034/035); say so in the PR comment.

Related: [[pr24-fc1-lessons]], [[batch-019-032-lessons]]
