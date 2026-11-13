---
name: pr33-fc1
description: PR #33 fix cycle 1 (2026-11-13, TASK-015 015-A) - Edit tool turns  -style escapes into literal chars, bootstrap gate proof by step order, stub-Jest heavy e2e, solo cycle timing
metadata:
  type: feedback
---

PR #33 fc1 was done solo in about 95 calls: 3 MAJOR, 3 MINOR and 4 security items. The gate and the evidence were green on the first run, and lane A came back as expected (only the record step red).

**Why:** these traps and recipes recur in CI-tooling fix cycles.

**How to apply:**
- **The Edit/Write tools decode ` `, ` `..` `, `　`, ` `/` ` escapes into LITERAL characters** inside JS string literals (`\u0000`, `\u007f`, `\u0085` survived). After writing tests with Unicode probes, scan the changed files for non-ASCII (a `node -e` per-line `[^\x09\x20-\x7e]` check) and re-escape them with a Write-ten scratch script (`split(ch).join('\\uXXXX')`).
- **Proving a new bootstrap gate on its own PR:** the scans job runs head copies of tools the base lacks, but a step placed after the record step never runs (that step is red on every owned-path PR before its record exists). Put the new gate before the record step, and give a no-op case real work (oasdiff no-tag: a smoke run of head vs head). Then the PR's own lane A run is the Linux proof; read it with `gh api repos/<o>/<r>/actions/jobs/<id>/logs | grep`.
- **Windows cannot prove POSIX modes.** Inject `chmod` into the helper so a unit test can observe the calls, and add a stat check that only runs when the platform is not win32.
- **heavy.mjs wiring test:** in the fixture repo, a stub `node_modules/jest/bin/jest.js` (CommonJS, plus `.gitignore` `node_modules/`) writes the Jest JSON to `--outputFile` and the coverage summary to `--coverageDirectory=`. A `kind: jest` runner with `coverage: true` then exercises the real pipeline in about 2 s.
- **Mutation proof of a single line:** `git diff --quiet -- f && sed -i '/pattern/d' f && run test; git checkout -- f`.
- Foreground `sleep N; cmd` is blocked. Wait with `timeout 300 bash -c 'until <check>; do sleep 10; done'`.
- `free`/PowerShell memory probes in a chained Bash command were refused by auto mode. Don't chain them.

Related: [[pr23-fc1-lessons]], [[lane-b-evidence-run]], [[pr20-fc3]]
