---
name: project-p5-task295
description: TASK-295 effect override (replaces D-SECAUDIT-02 waiver) r1 @5edc54f5 PASS_W_F-U, record 89d0b769 on main; PR295-SEC-01 LOW stale-override test, 02/03 INFO; merge-only round owed after m1 branch update
metadata:
  type: project
---

**Round 1 (2026-11-20), head `5edc54f5` on main `8281055c`: PASS_WITH_FOLLOW-UPS.** Record `docs/05-quality/security/PR-pending-TASK-295-security-review.md`, decision D-SECPR295-01.
- `overrides: { "@prisma/config": { "effect": "3.22.4" } }`; lockfile changes in exactly 3 leaves of `node_modules/effect`. Integrity, signatures and SLSA provenance were verified (Effect-TS/effect `refs/heads/v3`).
- GHSA-7589-6fvf-x4pw is gone. ReDoS probe: 3.20.0 takes 614 ms at n=2000; 3.22.4 takes 0 ms at n=1e6.
- **EFFECT-SEC-01 closes on merge, and D-SECAUDIT-02 is discharged. EFFECT-SEC-02 and -03 still stand.**

**Open items:**
- **PR295-SEC-01 LOW.** An unversioned override key lets a future Prisma bump silently force effect 3.22.4. Fix: a `tools/ci/root-overrides.test.ts` that pins three things: the premise (`@prisma/config` declares effect 3.20.0), the single effect tuple at the override version, and the set of override keys. Owner devops-engineer. Due before the next `@prisma/config` or `prisma` tuple change, at the latest G3.
- PR295-SEC-02 INFO: `npm ci` accepts a lockfile that contradicts an override.
- PR295-SEC-03 INFO: the scan-image-secrets comment says "effect 3.20.0". The same six paths still match in 3.22.4.

**Round 2, merge-only (PR #79), head `a1b0ba76`: PASS_WITH_FOLLOW-UPS.** Commit `2b5ab645`, decision D-SECPR295-02.
- `a1b0ba76` merges the lane B evidence commit `253f7f4a` with main `4e1163aa`.
- `package.json` is the union of the `tokens:build` script and the override.
- The lockfile blob is the same as `5edc54f5`, still 3 leaves against main. Its SHA-256 equals the lane B summary's.
- The merge tree is the clean merge-tree everywhere except the DECISIONS union.
- The record keeps both Head rows; simulation 6/6.

**Still open after round 2:**
- `a1b0ba76` conflicts again with main `89d0b769` in DECISIONS. The next union update touches only docs, so it does not void round 2 (simulated).
- Lane B ran `unit` only, because the image suites are "planned". PR295-SEC-03 rests on the emulation, and the D-TASK295-03 migrate/shadow question goes to the orchestrator.
- The scratchpad was wiped mid-round 2 again. I rewrote the section texts from context.

**Facts:**
- npm 11.19.1's `npm ci` lock check passes all four pairings of override and lock. Reproduce it read-only with npm's bundled Arborist: `loadVirtual`, `buildIdealTree`, `lib/utils/validate-lockfile.js`. Script: `scratchpad/t295/scripts/ci-validate.mjs`.
- `npm ls --package-lock-only` does exit 1 on the mismatched pairing (twin).
- The gitleaks v8.30.1 `generic-api-key` rule has **no digit check**: a digit-less secret is still flagged. With that check removed, my emulator (`scripts/gl-dir.mjs`) reproduces the six D-TASK014-19 effect paths exactly.
- A `module.registerHooks` resolve hook must return a short-circuited URL (via a guarded `createRequire(...).resolve`). For CJS `require`, `nextResolve` with a modified `parentURL` is ignored.
- `prisma@latest` is 8.0.0-rc.34, which no longer uses `@prisma/config`.

**Process slip, shared index race (2026-11-20).** The architect's `git commit` (`fcb2a732`) ran after I had staged my files, so it swept up my record and my entry. Before that, I had staged their 116 unstaged DECISIONS lines with a plain `git add`, against my own rule. They soft-reset, re-committed without my files as `d7925b70` and pushed. My files stayed staged. I then committed them alone, guarded in one command, as `89d0b769`, and pushed.
- Never `git add` a shared file; always use hash-object + `update-index --cacheinfo`.
- Commit immediately after staging, in the same command.
- `git status` is not a lock: re-check it in the same command as the commit.

Related: [[project-p5-audit-effect-waiver]], [[project-p5-pr67-picomatch-waiver]], [[project-security-review-conventions]]
