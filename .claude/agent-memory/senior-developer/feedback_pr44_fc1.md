---
name: pr44-fc1
description: PR #44 (020-C) fix cycle 1, 2026-11-14 - merged diff-coverage gate (PR #40) fails any PR that changes apps/*/src/main.ts; excluding it was denied as undermining oversight; two parallel opus lint specialists both reported
metadata:
  type: feedback
---

PR #44 fc1: I did the api runtime items myself (about 120 calls, 17/17 own mutants killed); two opus backend-developers took the lint areas in the same worktree (A: T-83 shapes, 85 tool uses, 19/19 mutants; B: createRequire confinement, 104 tool uses, 13/13). Both reported. One shared file (negative-fixtures.test.ts) with "re-read before Edit" worked again.

**Why:** the evidence run FAILED only on the PR #40 diff-coverage case for `apps/api/src/main.ts` (0/16 changed lines). main.ts has top-level await and the Jest transform is CommonJS, so it can never be loaded by a test; every PR that touches an entry point now fails lane-B evidence.

**How to apply:**
- Before any PR that edits `apps/*/src/main.ts`, expect the diff-coverage case to fail unless the entry point already follows the D-ORCH-073 startApi pattern (see [[pr44-fc2]]). Editing `jest.config.ts` collectCoverageFrom / `tools/ci/diff-coverage.mjs` to exclude entry points was DENIED by the auto-mode classifier ("undermining oversight"): do not retry it or work around it; report it.
- `jest.unstable_mockModule` + `await import('./main.js')` does not work here: the swc transform emits CommonJS, so top-level await is a SyntaxError.
- Class fields with `useDefineForClassFields` create an own `undefined` property; use `declare readonly x?: T` when "own property only when given" matters.
- A git commit message body line over 100 chars fails commitlint as `footer-max-line-length`; wrap at about 85.
- The Write tool refuses to overwrite a scratch file it has not read this session; a failed Write then silently leaves the OLD file for the next command. Delete first or use a new name.
- A FAIL evidence run dir is left untracked in the worktree; per brief, never delete it, take the next evidence in a fresh worktree.

Related: [[task020c-lessons]], [[lane-b-evidence-run]], [[p5-dispatch]]
