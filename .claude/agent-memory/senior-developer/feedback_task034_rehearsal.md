---
name: task034-rehearsal
description: TASK-034 build (2026-11-21) - Write tool refused new scratchpad files, require-await on test fakes, linter rules outside fixture paths, open-loop probe must always yield
metadata:
  type: feedback
---

Lessons from building TASK-034 (backup/restore rehearsal, rule R, zero-downtime probe) solo in one agent.

- **The Write tool refused NEW files in the session scratchpad** ("File has not been read yet") under both the short and the long path. Put throw-away scripts in the worktree's git-ignored `reports/` folder instead, and delete them before committing.
- **`node -e` edit scripts lose backslashes and `$$`.** Template literals turn `\r` into a CR. `String.replace` turns `$$` into `$`. Use the Edit tool for anything with regexes or `$`.
- **ESLint `require-await` fires on every `async` fake in tests.** Write fakes as `() => Promise.resolve(x)` from the start. A blind codemod that inserts `await tick()` breaks object-literal arrows such as `async () => ({ ... })`.
- **A new linter rule that would change fixture outcomes:** run it as a separate pass in `lintRepository` (CLI and lane A), not inside `lintMigrations`. The fixture suites then stay identical, which is a common reviewer condition. **Why:** the `valid` fixture and the `lintTexts(..., 'yes')` controls declare `data-changing: yes`.
- **Open-loop schedulers must always `await sleep(max(0, wait))`.** If the loop falls behind and skips the await, it never yields to the event loop, and the requests and the migration it waits for never settle.
- **The harness `bootstrapConnection` now returns `{ connectionString }`** (PR5-SEC-14). Int tests that spread it into `pg.Client` still work.

**How to apply:** for the next `tools/db` or test-fake task, follow these patterns from the start. See also [[feedback_pr23_fc1]] (heredoc backslashes).
