---
name: pr54-fc1
description: PR #54 (020-D) fc1 and fc2, 2026-11-16/17 - flake triage by isolated rerun, 0xC0000142 spawn failures, MSYS mangled gitleaks config, host-slot wait script, prerender-timeout INVALID runs, setTimeout seam pin
metadata:
  type: feedback
---

Resuming 020-D fc1 took about 60 calls and about 1 h wall. The first fresh lane-B run PASSed after a main merge (W0-FLAKE), and lane A was pushed once.

**Why:** two FAILed evidence runs looked like regressions, but every failing suite passed in isolation. The traps below cost time or nearly gave false confidence.

**How to apply:**
- **Triage a FAILed run first:** extract the failing testcases from `unit.junit.xml` (a node regex over `<testcase>` with `<failure>`). Rerun exactly those files in isolation (paths BEFORE `--selectProjects unit`). Then intersect the files with `git diff --name-only <merge-base> HEAD`.
- **Exit code 3221225794 = 0xC0000142** (STATUS_DLL_INIT_FAILED) means a child process could not start under host load. A spawnSync that reads `.stdout` then sees empty output: `git ls-files` returned nothing, so the record tripwire reported "0 records". It is not a record-format bug.
- **`git show origin/main:.gitleaks.toml > file` in Git Bash** gets MSYS-mangled to `origin\main;...`, fails, and leaves an EMPTY config. Gitleaks then "passes" with no rules. Use `MSYS_NO_PATHCONV=1` and check `wc -l` on the config before scanning.
- **Keep scripts and logs in `Garudavega/.t020d-fc1/`** (outside the worktrees), not in the scratchpad, which gets wiped. A wait-and-run script polls `ps -ef | grep quality:heavy` plus `docker ps --filter label=org.testcontainers=true`, then runs a targeted int file, and only then the evidence script. This kept the host to one heavy run without a shared lock dir; no docker.lock existed anywhere.
- **A mutant script (apply one exact string, run the twin's test, restore in `finally`)** over both lexer twins took about 6 min for 18 mutants.
- **A security condition that asks for "one PostgreSQL case"** needs an int test even when unit guard tests exist. For session forms, the observable is "call/handler never ran" plus a server-side probe (`pg_locks`), not a row count: the load transaction is read-only, so an INSERT fails anyway.

**Fix cycle 2 (2026-11-17), about 90 calls; 4 heavy attempts for one PASS.**
- **Two INVALID runs came from the web build, not the code.** React Router prerender gives each page a 10 s `AbortSignal.timeout` with `retryCount = 0`, so `/en/` fails under host load within about 35 s. Read heavy.log for "Prerender: Request failed". Gate the rerun on a load probe (2e8 loop < 1.6 s) as well as the slot.
- **A FAIL with P1001 in only the catalog suite** (446 s instead of 40 s) meant the container was lost. Prove it with a targeted rerun of those files in the ev worktree, archive the failed run dir outside the tree, then rerun the full run.
- **When a mid-run brief adds code, kill your own pending or running heavy run:** `ps -W`, then `taskkill //T //F` on its node. Re-point the clean ev worktree with `checkout --detach <new sha>`.
- **`jest.spyOn(globalThis, 'setTimeout')` pins a deadline seam deterministically** (the delay reaches the timer). Assert "the configured value armed exactly once", not "the default absent": other 20 s timers exist (`AFTER_COMMIT_DEADLINE_MS`).
- **Real-template collateral check:** `templates-verdict.mjs` in `.t020d-fc1` parses a `git archive` of the head with typescript-estree and compares the old and new lint twin over every tagged `$queryRaw`/`$executeRaw` (155). Use the new test row as the positive control.

Related: [[pr54-evidence-push]], [[task020d-resume]], [[lane-b-evidence-run]]
