# PR-0057: TASK-288 (TASK-W0-FLAKE-2) prisma/generated reader lock, security review

| Field | Value |
|---|---|
| PR | #57 `test(harness): prisma/generated reader lock and probe connect-timer race (TASK-288)`, https://github.com/sukhchdit/shipcube/pull/57, branch `test/TASK-288-flake2`. Commits on the merge base `8984b16`: `cfd9171` (reader lock, Jest shim, lock tests), `c4a4462` (probe connect timer, `deps:rebuild` clock inside the lock), `4c3d13a` (lane B evidence only, 4 files) |
| Head | 4c3d13a00bd875e61976ff6c004b3fd7fcb4b021 |
| Lane A evidence | Run 44005361656 on `4c3d13a` (`pull_request`). `fast-lane` **success** in full mode: workflow policy, install flags, migrations immutable, lockfile, cooldown, licences, signatures, audit, "Lane B evidence", `deps:rebuild`, commitlint, lint, lint-porcelain, format, actionlint, type-check, unit, base-ref negative lint fixtures, build, build-porcelain, Semgrep self-test. `scans`: Gitleaks (PR commit range), Semgrep and oasdiff **success**; the only red step is "Security-owned paths need a review record" (this record). `security-integration` **skipped**: the base-ref classifier reported `security_paths=false` (§6) |
| Lane B evidence | `20261117T0234Z_c4a4462`, profile `pr`, verdict PASS, one suite selected (`unit`: 5,954 tests, 0 failures, 0 errors, 2 skipped); merged coverage 99 % lines, 97.03 % branches. No `integration`, `catalog-c1-c14` or `rls-cross-tenant` run at this code tree (condition C1) |
| Code review twin | `docs/05-quality/reviews/PR-0057-TASK-288-code-review.md`, round 1, **APPROVED_WITH_NITS**, committed on the PR branch as `d44e022` (docs only, after `4c3d13a`) while this round ran. Its R1-m1 = PR57-SEC-03; its R1-m2 and R1-n3 are part of PR57-SEC-04; its R1-n4 is the pass-through note in §5.2; its R1-n5 and §4 ask for the §6 ruling |
| Owned paths changed | 8 (checker `owned[]`): `jest.config.ts`, `tools/db/prisma-client-locked.cjs`, `tools/db/prisma-client-locked.test.ts`, `tools/db/prisma-client-package.test.ts`, `tools/deps/ignore-scripts.test.ts`, `tools/test-support/fs-lock.test.ts`, `tools/test-support/fs-lock.ts`, `tools/test-support/lock-children.ts` |
| Unowned paths changed | The run directory `docs/05-quality/tests/runs/20261117T0234Z_c4a4462/` (4 files) |
| Binding items checked | D-SEC-PR53-01, D-SEC-PR53-02 (standing wall-clock rule; `SKIPPED_EXPORTS`), PR53-SEC-01..03, D-ARCH-103 / D-ARCH-130 (generated client as a value), PR4-SEC-11 and PR17-SEC-09 (Jest configuration ownership, manual mocks), PR46-SEC-08 (trigger-list coverage), D-ORCH-107 (one heavy run at a time), D-TASK288-01..08 |
| Reviewer / date | security-analyst, 2026-11-17, round 1. Git object reads and the checker ran in the main checkout. Probes ran in the session scratchpad on a type-stripped copy of the head `fs-lock.ts`, with a private `TEMP`/`TMP` and a private repository scope, so no real lock of any checkout was touched. One read-only `ESLint#lintText` run loaded the PR worktree's configuration (no cache, no file written). No Jest, no Docker, no install. In the PR worktree I ran only read-only git commands (`rev-parse`, `status`, `branch`, `log`, `config`) and `ls` before writing; then I wrote this file and committed it on top of `d44e022` |

## 1. Summary

The PR adds a reader side to the cross-process test lock that guards `prisma/generated`. A reader registers a `<pid>-<n>` file in `<lock>.readers`, then backs off if a writer of another live process holds the lock. Writers now also wait for live foreign readers. Every Jest project maps `@platform/prisma/client` to a CommonJS shim (`tools/db/prisma-client-locked.cjs`) that loads the generated client under the read lock. The probe in `prisma-client-package.test.ts` loses its 2 s pg connect timer, and the `deps:rebuild` budget is now timed inside the lock. Everything is test infrastructure. No production file, contract, migration, dependency or lockfile changes.

Requested checks, in brief:

- **Shim require path:** two static relative literals, no environment input.
- **Child processes:** no shell and fixed scripts.
- **D-SEC-PR53-02:** respected. No `timeOperation` use is added, and every new assertion is order-based.
- **PR53-SEC-01..03:** closed by the PR #53 record. The evidence still holds at this head.
- **Lock files in `%TEMP%`:** the new dead-reader cleanup trusts a predictable path in the shared temp directory. When `<lock>.readers` is a link, the writer deletes files named `<dead pid>…` in the link target, and the probe did exactly that through a junction (PR57-SEC-01, LOW). On this host and on hosted runners only the same user can plant the link. On a POSIX shared `/tmp`, `fs.protected_symlinks` blocks it by default.
- **Stale lock take-over:** races. A reader can remove a live writer's fresh lock (PR57-SEC-03, INFO). This was already true between writers.
- **Foreign entries and pid reuse:** junk or reused-pid entries in the readers directory block writers, or fail a load with `EEXIST` (PR57-SEC-04, INFO).

Both INFO items fail closed: a broken load fails the suite, it never passes it.

**Ruling on `security-integration`:** yes, add the paths, and also the active `rls-cross-tenant` suite's own roots (PR57-SEC-02, LOW). The owners are principal-architect (ADR-0023 trigger text) and devops-engineer in TASK-287. This PR is the concrete case: it changes module resolution in the `integration` and `generated` Jest projects, where `catalog-c1-c14` and `rls-cross-tenant` run, and neither lane B nor the hosted job ran those suites at this code tree. That is condition C1, a local run before merge. It needs no code change.

Findings: 0 Critical, 0 High, 0 Medium, 2 LOW, 2 INFO.

**Verdict: PASS_WITH_CONDITIONS** (C1).

## 2. Method

1. Read the full diff `8984b16...4c3d13a` (8 code files) and the head copies of `fs-lock.ts`, `lock-children.ts`, the shim, `jest.config.ts`, `tools/test-support/process.ts` (`findRepoRoot`, `runNode`), and every importer of `fs-lock` (`git grep`; 16 suites and harness files, all under `withFileLock`).
2. Read `prisma/package.json` (exports), `tools/repo/jest-config-owned.test.ts`, the Dockerfiles (`COPY tools/...` lines), `.github/CODEOWNERS`, `tools/ci/security-paths.mjs`, the `security-integration` and `scans` jobs of `ci.yml`, `tools/quality/{required-suites,suite-runners}.json`, `heavy.mjs` (`planRun`, `IN_BAND_PROJECTS`), ADR-0023 amendment G item 5 and amendment L items 2 and 4, the TASK-288 and TASK-287 cards, D-TASK288-01..08, D-SEC-PR53-02 and the PR #53 record (§R2.5, §R2.9).
3. **Lock behaviour probe** (`probe.mjs`, `p4.mjs`). It used the head `fs-lock.ts`, type-stripped, with `findRepoRoot` fixed to a private value, `TEMP`/`TMP` pointed at a private scratch directory, and a hook in `ownerAlive` to force one interleaving deterministically. Live and dead pids came from real child processes. Results in §5.1.
4. **Lint probe** (`lintprobe.mjs`). Six virtual files linted against the PR worktree's `eslint.config.mjs`, which this PR does not change: can production code import the shim or `fs-lock` lint-clean? A positive control (a value import of `@platform/prisma/client` in a module) must fire.
5. **Trigger-list replay** (`triggers.mjs`). Main's own `globsMatch` from `tools/ci/security-paths.mjs` was run over the current list and the proposed one: 14 path controls, and every first-parent code commit on `main` since 2026-11-01.
6. **Evidence checks.** I read the lane A step list (`gh run view --json jobs`) and the lane B `summary.json`. I ran a count-only host-fragment scan with run-time needles and a positive control over the 4 evidence files and the 2 new test files.
7. Read the code-review twin (`d44e022`) after my probes ran and mapped its items to mine. Its probes (P0 `kill(0, 0)`, the `EEXIST` collision, the take-over race) agree with mine where they overlap.
8. Record simulation (§8).

## 3. Findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner |
|---|---|---|---|---|---|---|
| PR57-SEC-01 | The dead-reader cleanup follows a link at a predictable path in the shared temp directory. A writer deletes every entry named `<integer that is not a live pid>[-…]` in whatever directory `<lock>.readers` points to, and the reader registration writes through the link. Not in the code review | LOW | CWE-59, CWE-377 | A01 | `tools/test-support/fs-lock.ts:40,44-46,75-87,96-99` | This PR's fix cycle if one is opened (the code review recommends one for R1-m2/R1-m3); otherwise W0-FLAKE-3 (to be carded at the next sheet fold, D-TASK288-08) |
| PR57-SEC-02 | The `security-integration` trigger list does not select the code that the security suites run through: `jest.config.ts`, `tools/test-support/**`, `tools/db/**`, `tools/deps/**`, nor the active `rls-cross-tenant` suite's own roots (`tests/generated/rls/**`, `tests/generated/api-mounts.ts`). PR46-SEC-08 escalated now that a suite outside `prisma/**` is active | LOW | CWE-693 | A04 | `tools/ci/security-paths.mjs:41-49`; ADR-0023 am. G item 5, am. L item 2 (a) | principal-architect (ADR-0023 trigger text) + devops-engineer in TASK-287 `fastlaneinc` (§6) |
| PR57-SEC-03 | Stale-lock take-over is check-then-act. A reader that read a dead owner can remove a live writer's fresh lock directory and enter while that writer regenerates. Readers now take over too; the writer-writer variant predates this PR. = code review R1-m1 | INFO | CWE-367 | A04 | `tools/test-support/fs-lock.ts:63-72` (reader), `:169-170` (writer, pre-existing) | Same as PR57-SEC-01 |
| PR57-SEC-04 | Readers-directory hygiene. Any entry that is not a `<pid>-<n>` registration counts as a live reader forever, so every writer waits out its 600 s deadline. A stale `<pid>-<n>` of a killed process whose pid is reused makes that process's first load throw `EEXIST`. `.readers` directories are never removed. The `EEXIST` and reused-pid parts = code review R1-m2 and R1-n3; the junk-entry and directory-removal parts are new here | INFO | CWE-703 | A04 | `tools/test-support/fs-lock.ts:75-87,97-99` | Same as PR57-SEC-01 |

## 4. Finding details

### PR57-SEC-01 (LOW): the dead-reader cleanup trusts a predictable shared path

**Description.** `lockPath(name)` is `join(tmpdir(), 'shipqube-test-lock-<sha256(repo root)[:12]>-<name>')` (`fs-lock.ts:40`), and `readersPath` appends `.readers` (`:44-46`). Both names are predictable from the checkout path. This PR adds two operations on the readers path, and neither checks what the path is:

- `tryRegisterReader` runs `mkdirSync(dir, { recursive: true })`, which accepts an existing link to a directory, and then `writeFileSync(<dir>/<pid>-<n>, '', { flag: 'wx' })` through it (`:96-99`).
- `foreignReaders` lists the directory and runs `rmSync(join(dir, entry), { force: true })` for every entry whose `Number(entry.split('-')[0])` is a positive integer that is not a live pid (`:79-82`).

So if `<lock>.readers` is a symbolic link or a junction, the cleanup deletes files outside the lock area.

**Evidence (probe P5, Windows host, head copy).** `<lock>.readers` was made a junction to a scratch directory holding `<dead pid>-report.txt` and `<dead pid>`. `withFileLock` then **deleted both files and ran**. The controls behaved as expected:

- P6: a junction at the writer path with a dead owner and a canary. Node's `rmSync(…, { recursive: true, force: true })` removed only the link, and the canary survived. The writer-directory take-over does not follow links.
- P3e: the parse is loose. `0x7FFFFFF0-1` was read as a pid and deleted.

**Exploitability and impact.** The attacker must create the link before the victim's first test run, at a path derived from the victim's checkout path. Where that is possible depends on the platform:

- **Windows `%TEMP%`** (lane B, this host): per-user ACLs, so only the same user can plant the link, and that user can already delete those files. No privilege boundary is crossed.
- **GitHub-hosted runners:** single-tenant ephemeral VMs.
- **POSIX shared `/tmp`:** the kernel default `fs.protected_symlinks = 1` refuses to follow another user's link in a sticky world-writable directory, so the probe's deletion would fail with `EACCES` (a denial of service, fail closed).

What is left is a multi-user POSIX host with `protected_symlinks = 0`, or a `TMPDIR` that points at a shared non-sticky directory. There, another local user can make a developer's or CI user's test run delete that user's files matching `^\d+(-.*)?$` in a directory of the attacker's choice, and can block every writer. Impact Low to Medium; likelihood Low. Rated **LOW**.

**Remediation (code level).** Pick one:

(a) **Preferred.** Move the lock root out of the shared temp directory and into the checkout, since the scope is already one checkout:

```ts
const LOCK_ROOT = join(findRepoRoot(), 'node_modules', '.cache', 'shipqube-test-locks');
export function lockPath(name: string): string {
  mkdirSync(LOCK_ROOT, { recursive: true, mode: 0o700 });
  return join(LOCK_ROOT, name);
}
```

`node_modules` is git-ignored and per worktree. Writers and readers change together, so the protocol is unchanged.

(b) Keep `tmpdir()`, but harden the readers path:

- before use, `lstatSync(readersPath(name))` and throw if `isSymbolicLink()` is true (Node reports junctions as symbolic links) or if it is not a directory;
- on POSIX, also throw if `uid !== process.getuid()`;
- create it with `mode: 0o700`.

In both cases, remove only entries that match `/^(\d+)-(\d+)$/u` (see PR57-SEC-04).

**Verification test.** In `fs-lock.test.ts`:

1. Create a scratch target holding `<deadPid()>-x`.
2. Run `symlinkSync(target, readersPath(name), 'junction')` (no elevation needed on Windows; `'dir'` on POSIX).
3. `withFileLock(name, …, 2_000)` must reject naming the readers path, and `<deadPid()>-x` must still exist.

As a control, the same stale entry in a real readers directory is removed and the writer runs (the existing case at `fs-lock.test.ts:117`). With option (a), assert instead that `lockPath(name)` starts with the checkout root.

### PR57-SEC-02 (LOW): the `security-integration` trigger list misses the security suites' harness, oracles and roots

**Description.** `SECURITY_INTEGRATION_PATHS` (`tools/ci/security-paths.mjs:41-49`) is ADR-0023 amendment G item 5 plus `package-lock.json`. The job runs the base manifest's active `security_integration_suites` with the head's `jest.config.ts`. Today those suites are `catalog-c1-c14` (`prisma/tests/catalog/`) and `rls-cross-tenant` (`tests/generated/rls/`, active since PR #47). Their behaviour depends on these files:

- `jest.config.ts`: the projects, `moduleNameMapper` and transform;
- `tools/test-support/**`: `fs-lock` and `runNode` in the Testcontainers harness `prisma/tests/harness/postgres.ts`;
- `tools/db/**`: `table-classes`, `sql-text`, `bootstrap`, `render-rls`, `audit-external-tables`, the oracle helpers that CODEOWNERS calls "the O4 oracles";
- `tools/deps/**`: `rebuild.mjs` and `prisma-engines.{mjs,json}`, which run in the job; `prisma-cli.mjs` is imported by the suites;
- for `rls-cross-tenant`, its own generator and cases.

None of these is in the list. Header comment `:11-13` says the left-out paths "do not change what the Testcontainers suites exercise". That holds for `tools/ci`, `tools/quality`, `.github` and `.npmrc`, but not for these. PR46-SEC-08 (INFO) recorded the gap and asked that each activation PR add its suite's roots. PR #47 activated `rls-cross-tenant` without doing so.

**Evidence.**

- This PR maps `@platform/prisma/client` in every project, `integration` and `generated` included (`jest.config.ts:56,67,129`), and the classifier said `false`.
- Lane B profile `pr` selected only `unit`, so no security suite ran at this code tree.
- The TASK-288 card promised the hosted run, because its planned file list included `prisma/tests/harness`, which is a trigger path. The PR did not touch that file.
- Replay (`triggers.mjs`, main's `globsMatch`, 14 of 14 path controls as expected): of the first-parent code commits on `main` since 2026-11-01, the current list selects 28 and the proposed one 30. The two new ones are `a813a01` (#33) and `b622edc`, both through `jest.config.ts`. PR #57 would be selected through `jest.config.ts`, the shim, `fs-lock.ts` and `lock-children.ts`.
- At about 8 job-minutes a run, that is roughly 20 to 30 minutes a month, inside the ADR-0023 am. L item 4 sensitivity band.

**Exploitability and impact.** A harness or oracle change that breaks or weakens the O3/O4 suites merges without the hosted Linux run on its head. The next selected PR, a lane B `wave` run or lane C catches it later. A deliberate weakening through `jest.config.ts` (say, a mapper that stubs `@platform/authz`) would not be caught by the job either, because the job runs the head's configuration. That class stays with the CODEOWNERS record, which is why this record reviews the new mapper (§5.2). Impact Medium (delayed detection of a broken O3/O4 proof), likelihood Low to Medium (about 1 PR in 12 in this period). Rated **LOW**.

**Remediation and owner.** See §6.

**Verification test.** Add path-corpus cases to `tools/ci/security-paths.test.ts`:

| Path | Selected |
|---|---|
| `jest.config.ts` | yes |
| `tools/test-support/fs-lock.ts` | yes |
| `tools/test-support/fs-lock.test.ts` | no |
| `tools/db/table-classes/audit.json` | yes |
| `tools/db/fixtures/lint/…` | no |
| `tools/deps/prisma-engines.json` | yes |
| `tools/deps/ignore-scripts.test.ts` | no |
| `tests/generated/rls/<any>` | yes |
| `tests/generated/api-mounts.ts` | yes |
| `tools/ci/lane-scope.mjs` | no |

Also keep the existing parity test with the manifest copy green.

### PR57-SEC-03 (INFO): stale take-over is check-then-act

**Description.** `foreignWriterHolds` reads the owner, calls `ownerAlive`, and then runs `rmSync(dir, { recursive: true })` (`fs-lock.ts:63-72`). If a live writer W2 takes over the same stale lock between the read and the remove (W2 does `rmSync`, `mkdir` and writes its own pid), the reader removes W2's fresh directory and then finds no writer. **Probe P2** forced that interleaving through a hook in `ownerAlive`: "BYPASS: reader removed the live W2 lock and entered while W2 holds it". The control (P2c, live owner, no interleaving) was refused correctly. The writer-writer race at `:169-170` predates this PR. This PR adds readers, which are numerous, as a second party that takes over.

**Impact.** This needs a writer killed while holding the lock, for example a Jest worker or a `WRITER` child killed by `afterEach`. `prisma-client-locked.test.ts:39` holds the real `prisma-tree` lock in such a child. It also needs two parties in the same window. The result is a load during regeneration, which raises `SyntaxError` or a missing export and fails the suite: fail closed, never a vacuous pass. There is no security impact; this is a test-integrity residual.

**Remediation.** Pick one:

- **Narrow the window:** re-read the owner just before removing, and remove only if it still equals the dead pid read first.
- **Atomic take-over:** `renameSync(dir, `${dir}.stale-${randomUUID()}`)`, then check the tombstone's owner. If it is not the dead pid, the rename stole a live lock: fail this attempt and do not delete. Remove the tombstone otherwise.

Either is acceptable for test infrastructure. Accepting it as a residual is also acceptable.

**Verification.** Re-run P2 against the fix. It must report no bypass, and P2c must still refuse.

### PR57-SEC-04 (INFO): readers-directory hygiene

**Evidence (probes P3, P4).**

- Entries `desktop.ini`, `0-1`, `-1` and `Infinity-1` each blocked `withFileLock` until its deadline. With the 600 s default, every writer of that checkout waits 10 minutes and throws, and nothing ever removes such an entry.
- A stale `<this pid>-1` made the first `withReadLockSync` of a fresh process throw `EEXIST` (`flag: 'wx'`, `:99`). That is a failed client load in the shim. While the reusing process lives, other writers also wait for the stale entry. Windows reuses pids quickly.
- A real `%TEMP%` already holds a stale `prisma-tree.readers` entry and five leftover `t288-<pid>-<n>.readers` directories from interrupted runs (listed, not opened).

All of these fail closed: a slow or failed test run, never a vacuous pass.

**Remediation.**

- Parse registrations with `/^(\d+)-(\d+)$/u` and ignore (do not wait on) anything else.
- Name registrations `${process.pid}-${randomUUID()}`, or on `EEXIST` for an own-pid name remove it and retry, because a same-pid entry can only be stale.
- In the writer's `finally`, `rmdirSync(readersPath(name))` and ignore `ENOTEMPTY`/`ENOENT`.

**Verification.** Cases for one junk entry (the writer runs), one own-pid stale entry (the reader enters), and a readers directory gone after the last writer.

## 5. Checks requested by the brief

### 5.1 Lock files and directories in `%TEMP%` (probe results, head copy, Windows host)

| Probe | Set-up | Result |
|---|---|---|
| P0 | `process.kill(0, 0)` | no throw: an owner file read as `''` (`Number('')` = 0) counts as **alive**, so the writer take-over at `:169` waits |
| P1a / P1b | writer directory with an empty `owner` (a writer between `open` and `write`) | the writer waited out its deadline, and so did the reader. No double ownership on this host |
| P2 / P2c | stale take-over interleaving / live owner | bypass (PR57-SEC-03) / refused |
| P3a-d | non-registration entries | writer blocked until the deadline (PR57-SEC-04) |
| P3e | `0x7FFFFFF0-1` | parsed as a dead pid and deleted |
| P4 / P4c | stale `<own pid>-1` / fresh directory | `EEXIST` (PR57-SEC-04) / entered, no registration left |
| P5 | readers directory is a junction | both victim files in the target deleted (PR57-SEC-01) |
| P6 | writer directory is a junction, dead owner | link removed, target and canary kept |

The questions from the brief:

- **Predictable names.** Yes. They are derived from the checkout path, and the writer half predates this PR. On this host's per-user `%TEMP%` that alone grants nothing.
- **Permissions.** Directories are created with the process umask (no explicit mode). On Windows they inherit the user-only `%TEMP%` ACL. The markers and the race-control module files live in `mkdtemp` directories (0700 on POSIX).
- **Cleanup of dead owners deleting another user's files.**
  - On default configurations it cannot reach another user's files. On Windows, `%TEMP%` is per user. On POSIX `/tmp`, `protected_symlinks` blocks following another user's link, and the sticky bit stops removal of another user's directory, so the attempt throws, fail closed.
  - `ownerAlive` treats `EPERM` (another user's live process) as alive, so a foreign user's live lock is never taken over.
  - What remains is the link-following residual of PR57-SEC-01.
- **Test-suite cleanup.** `fs-lock.test.ts` `afterAll` removes only the `t288-<own pid>-<n>` names it created, and `rmSync` does not follow links (P6).

### 5.2 The shim and its require path

`prisma-client-locked.cjs:10` requires `'../test-support/fs-lock.ts'` and `:12` requires `'../../prisma/generated/prisma/client.ts'`. Both are string literals, resolved relative to the shim. No environment variable, argument or configuration reaches either path.

- Neither specifier ends in `.js`, so `JS_EXTENSION_MAPPER` leaves both alone.
- `.cjs` does not match the SWC transform pattern, so the shim runs as written.
- The transitive closure (`fs-lock.ts`, `process.ts`, `prisma/**`) is entirely CODEOWNED. `tools/repo/jest-config-owned.test.ts` asserts that every mapper target is owned, and the shim is (`/tools/db/`).
- The only environment-derived input is the lock directory: `tmpdir()` plus `findRepoRoot()` from the cwd. A process that controls that environment already controls `NODE_OPTIONS`.

**The shim is a pass-through.** `prisma-client-locked.test.ts:56,59` asserts that the shim returns the same module object as the source file. Since `SWC_JEST_OPTIONS` emits CommonJS, the shim and the relative imports in `prisma/tests/**` share one registry entry, so no second client instance appears. The hard-coded source path equals the `@platform/source` export target, and `prisma-client-package.test.ts:51-58` pins that target exactly. A future change to the export map has to edit that pin and this shim together. Nothing ties the two literals mechanically: reading the target from `prisma/package.json` in the pass-through test would (= code review R1-n4).

**No production path.**

- **Packaging.** Production resolves `default` → `dist/client/client.js`. No Dockerfile copies the shim: api and worker copy three named `tools/db` files and `tools/deps/`, and prisma copies none.
- **Lint probe.** A production import of the shim is refused. S1 (module), S2 (non-home `platform/db`), S3 (`fs-lock` from a module), S4 (worker) and S5 (package) each gave 1 error, `import-x/no-relative-packages`. The positive control gave 2 errors (`platform/prisma-client-construction`, `boundaries/dependencies`).
- **Only one lint rule fires.** The shim re-exports the generated module whole from an allowed value home (`tools/db`), so the generated-client rules do not classify it. This is the same shape as the D-ARCH-130 residual and is acceptable while `tools/**` is outside every image.

**The mapper itself.** The only new mapper is `^@platform/prisma/client$` (exact), placed before `JS_EXTENSION_MAPPER` in every project, `unit-dom` included. It stubs nothing and redirects no other module. `/__mocks__/` stays ignored, and `jest.mock('@platform/prisma/client', …)` keys on the same resolved path as before.

### 5.3 Child processes (`lock-children.ts`)

`spawn(process.execPath, ['-e', script, '--', ...args], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })` at `:61`:

- no shell;
- the executable is `node`, not a `.bat`/`.cmd`, so the Windows argument-quoting class does not apply;
- `script` is one of two module constants (`WRITER`, `READER`);
- `args` are paths from `lockPath`/`readersPath`, `mkdtemp` markers and constant hold times.

The child inherits the Jest process environment, which is the same trust domain. `afterEach` kills every child. A killed `WRITER` leaves its lock directory with a dead owner, which feeds PR57-SEC-03. The `WRITER` in `prisma-client-locked.test.ts:39` takes the **real** `prisma-tree` writer lock for 400 ms without waiting for readers. That is harmless because it writes nothing under `prisma/generated` (no `file` argument). `deadPid()` spawns `node -e ''` and waits for its exit.

### 5.4 D-SEC-PR53-02 and the wall-clock rules

**No new `timeOperation` user.** Its users at this head are the same four files as at the PR #53 squash `ae1e38b`. Its JSDoc states the standing rule (`apps/api/src/platform/routing/tests/timing.ts:5-9`), unchanged since `ae1e38b`.

**New tests assert order, not time.** Each assertion checks that a `released` marker exists, or does not exist, when the waiting side gets through.

| Remaining time value | Role |
|---|---|
| `jest.setTimeout(120_000)` | hang detector |
| 300 ms deadline cases | assert only the error text and that no registration is left |
| `withFileLock(…, 5_000)` | applies only inside a contended loop |
| `deps:rebuild` budget (`ignore-scripts.test.ts:183-187`) | a performance guard, not a security control (R2-n5). Timing it inside the lock narrows what it measures to the rebuild itself, and the budget is unchanged |

**The probe change** (`prisma-client-package.test.ts:127-148`):

- It drops `connectionTimeoutMillis: 2000`. `runNode`'s 300 s default still bounds a hang (D-SEC-PR53-01 accepted that default).
- The connection string carries no password.
- The new `detail` (message, cause, stack head) is printed only when the error class is wrong. Lane B scrubs case output (`hostScrubList`/`scrubCases` in `heavy.mjs`).

`SKIPPED_EXPORTS` is untouched.

### 5.5 PR53-SEC-01..03 as closed by the PR #53 record

Confirmed. The PR #53 record on `main` (§R2.5) shows the following at this head:

| Item | Status in the PR #53 record | Evidence still holds at this head |
|---|---|---|
| PR53-SEC-01 | Closed, residual accepted (line 433) | JSDoc rule at `timing.ts:5-9` |
| PR53-SEC-02 | Closed (line 434) | `server.test.ts:53` still pins `[headersTimeout, requestTimeout]` = `[5_000, 5_000]` |
| PR53-SEC-03 | Closed, residual accepted (line 435) | `fetchOnce` contract and JSDoc in `loopback.ts` unchanged since `ae1e38b` |

The PR #53 round-2 verdict (line 495) is PASS_WITH_FOLLOW-UPS. One citation slip: the PR body cites "lines 434-435 and 492", but PR53-SEC-01 is on line 433, and line 492 is the round-2 Findings row, which also lists all three as closed. This needs no change to the record; correct the PR body if it is edited again. PR53-SEC-05/06 are routed to TASK-283 (D-ARCH-136), not here, which is consistent with D-SEC-PR53-02.

### 5.6 Evidence

- The lane A step list is as stated in the header.
- Lane B `20261117T0234Z_c4a4462`: `git_sha` `c4a4462`, `git_dirty` false. Only the evidence commit `4c3d13a` follows it, and it touches only the run directory.
- **Host-fragment scan.** A count-only scan used run-time needles: OS user, 8.3 stem, home and temp in both separator forms, host name and git e-mail. It scored 0 for every needle in `unit.junit.xml`, `summary.json`, `summary.md`, `coverage-summary.json`, `fs-lock.test.ts` and `prisma-client-locked.test.ts`. The synthetic control found 8 of 8.
- **Secrets.** Lane A Gitleaks over the PR range passed.

## 6. Ruling: should `jest.config.ts`, `tools/test-support/**`, `tools/db/**` and `tools/deps/**` select `security-integration`?

**Yes.** Each changes what the security suites exercise:

- `jest.config.ts` defines the `integration` and `generated` projects the job runs, their mappers and their transform.
- `tools/test-support/**` is the Testcontainers harness's lock and process layer.
- `tools/db/**` holds the catalog and RLS oracle helpers.
- `tools/deps/**` runs inside the job and decides which Prisma engine and CLI apply the migrations the suites prove. The same reasoning as D-ARCH-133.

The header reason in `security-paths.mjs` for leaving paths out does not apply to them. **Add also** the active `rls-cross-tenant` suite's own roots, `tests/generated/rls/**` and `tests/generated/api-mounts.ts`. Both are already CODEOWNED. PR46-SEC-08 asked for this at activation, and PR #47 did not do it.

Leave test-only files out, since the job never runs them. Proposed additions in the classifier's own dialect, with all 14 path controls as expected under main's `globsMatch`:

```
'jest.config.ts', 'tools/test-support/**', 'tools/db/**', 'tools/deps/**', 'tests/generated/rls/**', 'tests/generated/api-mounts.ts',
'!tools/test-support/**/*.test.ts', '!tools/db/**/*.test.ts', '!tools/db/fixtures/**', '!tools/deps/**/*.test.ts',
```

The negations are path-scoped, so they cannot exclude a `prisma/**` or `packages/**` test. The cost is two more selected PRs in the last 17 days, about 20 to 30 job-minutes a month.

**Owner.**

- **principal-architect** amends the trigger text of ADR-0023 amendment G item 5 / amendment L item 2 (a) in the next sheet fold. It should state the rule from PR46-SEC-08: each suite activation adds its roots. The plan generator's DoD line "Touches a security-critical path: the hosted `security-integration` job runs" should be derived from the trigger list, not from the planned file list, so a card cannot promise a run the classifier will not do.
- **devops-engineer** implements it in **TASK-287** `fastlaneinc`. That task holds the `ci-workflows` lock and already edits the lane-scope path classification in `tools/ci/`. The work is `security-paths.mjs` plus `security-paths.test.ts` (corpus in §4, PR57-SEC-02). The base-ref rule means it takes effect for the PRs after it merges.
- PR46-SEC-08's other two paths (`.npmrc`, `apps/worker/src/platform/**`) stay open with it.

**For this PR.** The base-ref list cannot be widened for PR #57 itself, so `security-integration` will stay skipped and `ci-gate` will accept that (classifier `false`). Condition C1 replaces the hosted run with a local one.

## 7. Conditions and follow-ups

| Item | Owner | Due |
|---|---|---|
| **C1:** run `integration`, `catalog-c1-c14` and `rls-cross-tenant` at this record's code tree (code-identical to `4c3d13a`), once no foreign Testcontainers run is active (D-ORCH-107). Command: `npm run quality:heavy -- --profile pr --suites integration,catalog-c1-c14,rls-cross-tenant --out-root <a directory outside the repository>`. `--suites` makes the run restricted, so its verdict is INVALID by design. It is not profile evidence and is not committed. Required result: each of the three suites `passed` with 0 failures, 0 errors and 0 skipped; `rls-cross-tenant` ≥ 126 tests, `catalog-c1-c14` ≥ 14 tests. The orchestrator logs the stamp and counts in DECISIONS.md. A failure returns the PR to fix cycle 1. No security delta round is needed when C1 is green and no owned path changes | orchestrator (run by test-engineer or qa-lead) | before merge |
| PR57-SEC-01, -03, -04 | this PR's fix cycle if the code review opens one; otherwise W0-FLAKE-3 (principal-architect cards it at the next sheet fold with D-TASK288-08) | next change to `tools/test-support/fs-lock.ts` |
| PR57-SEC-02 | principal-architect (ADR text) + devops-engineer, TASK-287 | before TASK-287 merges |

**If a fix cycle is opened** (the code review recommends R1-m2 and R1-m3, and R1-m1 at least in its detection form), fold in PR57-SEC-01 (lock root under the checkout, or the `lstat` refusal) and the strict registration regex of PR57-SEC-04. Any push to `fs-lock.ts`, `lock-children.ts` or the other 6 owned paths voids this record. The delta round then re-runs `probe.mjs` P2 to P6, `p4.mjs` and the lint probe on the new head, and C1 moves to that head.

**Merge prerequisites.** Main has moved since the merge base `8984b16`, under `tools/ci/**` and `.github/dependabot.yml` (PR #55). None of those paths is owned by this PR, so a union with `main` (D-ORCH-112 P1) does not void this record (checker (d) reads the PR's own net change). Any later push to one of the 8 owned paths does.

## 8. Record simulation

The record was committed on top of the branch tip `d44e022` (the code review commit, docs only after `4c3d13a`) in a sparse `git clone --shared` (scenario commits built with plumbing). S4 and S5 sit directly on `4c3d13a`. `main`'s `tools/ci/check-security-owned-paths.mjs` (the same as the merge base's copy; PR #55 did not change it) was run as `--base <base> --pr 57 --json`. All 7 scenarios came out as expected; the checker reported 8 owned paths in each:

| Scenario | Expected | Result |
|---|---|---|
| S0 head without a record (`4c3d13a`) | missing | missing, exit 1 ("no record named … PR-0057-*.md") |
| S1 this record on `d44e022`, base `origin/main` | pass | pass, exit 0, satisfied by this record at `4c3d13a` |
| S1b the same, base = merge base `8984b16` (the lane A event base) | pass | pass, exit 0 |
| S2 S1 plus an edit of `tools/test-support/fs-lock.ts` after the record | missing | missing, exit 1 ("names 4c3d13a, but tools/test-support/fs-lock.ts changed after it") |
| S3 S1 plus a docs-only commit | pass | pass, exit 0 |
| S4 the record with its final Verdict cell set to `FAIL` | missing | missing, exit 1 (verdict not accepted) |
| S5 the record naming a commit outside the PR range (`8984b16…`) | missing | missing, exit 1 ("its head row names no commit of this PR") |

Exactly one table row has a first cell starting with `Head`, and exactly one has a first cell equal to `Verdict` (the last row of §9). The file is LF.

## 9. Verdict

| Field | Value |
|---|---|
| Findings | 0 Critical, 0 High, 0 Medium; 2 LOW (PR57-SEC-01 link-following cleanup, PR57-SEC-02 trigger list); 2 INFO (PR57-SEC-03 take-over race, PR57-SEC-04 readers-directory hygiene) |
| Conditions | C1: `integration`, `catalog-c1-c14` and `rls-cross-tenant` green at this code tree before merge (§7) |
| Follow-ups | PR57-SEC-01/-03/-04 → this PR's fix cycle or W0-FLAKE-3; PR57-SEC-02 → principal-architect + TASK-287 (§6); PR46-SEC-08 remainder stays open |
| Verdict | **PASS_WITH_CONDITIONS.** The reader lock, the shim and the lock tests are test-only. The shim's require paths are static, and production code cannot import it lint-clean. Child processes run without a shell. The D-SEC-PR53-02 rules hold, and PR53-SEC-01..03 stay closed. The temp-directory cleanup follows links (LOW, same-user or non-default POSIX only), and the stale take-over races (INFO, fail closed). Because the hosted job cannot run for these paths, the security suites must be run once at this code tree (C1). No Critical or High finding is open for this change |
