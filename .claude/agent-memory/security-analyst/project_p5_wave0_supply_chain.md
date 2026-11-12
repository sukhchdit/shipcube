---
name: project-p5-wave0-supply-chain
description: PR-0001/TASK-001 review rounds 1-2 (2026-11-12) PASS_WITH_FOLLOW-UPS; non-obvious supply-chain facts (@platform pin side effects, Prisma engine download, bcrypt 18-month, elkjs SPDX) and what to check in TASK-003/004/007/014/049/214 reviews
metadata:
  type: project
---

PR #1 (TASK-001) review: `docs/05-quality/security/PR-0001-TASK-001-security-review.md`. IDs are PR1-SEC-01..13.
- **Round 1** (`76b69c0`): PASS_WITH_FOLLOW-UPS.
- **Round 2** (`4ec1bc4`): PASS_WITH_FOLLOW-UPS.
  - PR1-SEC-01 (`@platform` pin) and PR1-SEC-07 (OTel meta-package removed; `npm audit --omit=dev` = 0) are resolved.
  - New: PR1-SEC-12 LOW and PR1-SEC-13 INFO, both routed to TASK-007.
  - PR1-SEC-02/03/04 MEDIUM remain latent.

**Non-obvious facts. Re-verify them before relying on them.**
- **`@platform` npm scope.** It is a third-party org on npmjs.com, and it is also our workspace scope.
  - The pin is `.npmrc` `@platform:registry=https://registry.invalid/`. It makes fresh resolution fail closed.
  - It does **not** cover a lockfile `resolved` URL. Arborist's `replace-registry-host` rewrites against the default registry only, never a scoped one. So the link-only lockfile check is load-bearing, and it must also catch npm aliases (`name: "@platform/*"` under another key).
  - The pin **breaks `npm audit signatures`** (verify-signatures prefetches keys for every edge's registry, including workspace edges, and rethrows ENOTFOUND) and **`npm outdated`**.
  - The safe form is `npm audit signatures --@platform:registry=https://registry.npmjs.org/`. Verified: exit 0, no `@platform` requests, because workspaces are skipped.
- **Lockfile diffs.** `package-lock.json` is `-diff` in `.gitattributes`. Diff it with `git show <sha>:package-lock.json` plus a structural Node script, comparing new name@version tuples, integrity changes and flag moves.
- **Prisma engine download.** Prisma 7 CLI `generate`/`migrate`/`db`/`version` call `ensureNeededBinariesExist`, which downloads native `schema-engine` from binaries.prisma.sh.
  - The only check is a SHA-256 from the same origin, and `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING` can skip it.
  - On the dev host the shared cache `%APPDATA%\Prisma\master\<hash>` masks this (PR1-SEC-02).
- **`bcrypt`.** 6.0.0 crossed the 18-month rule on 2026-11-11. This is an architect decision (PR1-SEC-06).
- **`elkjs`.** The SPDX is plain `EPL-2.0`, not "OR GPL". It arrives via prisma → @prisma/studio-core.
- **Studio is loaded eagerly.** Prisma `cli.js` requires `@prisma/studio-core/data/*` at module level, so a Studio-free migrate image likely needs a stub.
- **Production-closure deprecations.** After round 2, the only deprecated package in the production closure is `node-abort-controller` 3.1.1 (BullMQ), which needs an architect ruling.

**Why:** the binding requirements in review §6 and R2.6 are spread over later tasks, and the gates close only if each later review checks them.

**How to apply:** in P5 reviews, check these items:
- TASK-003: an engine-pin step in deps:rebuild, refusal of PRISMA_ENGINES_* variables, CHECKPOINT_DISABLE.
- TASK-004: a custom `app/entry.server.tsx` and no `isbot`.
- TASK-007:
  - the `npm audit signatures` override form, allowed on that command only;
  - a lockfile-driven freshness gate, no `npm outdated`;
  - Dependabot `ignore` for `@platform/*`;
  - `check-lockfile` `name`/`resolved` rules for `@platform/*` (aliases);
  - a lockfile delta summary;
  - the post-build `git status --porcelain` gate;
  - the elkjs, png-js and caniuse-lite licence handling;
  - that the freshness gate waits for the bcrypt and node-abort-controller rulings.
- TASK-014:
  - `--omit=dev --omit=optional`, installed from the workspace root;
  - no schema-engine, prisma, studio or elkjs in the api/worker images;
  - the migrate image tested.
- TASK-214: explicit instrumentations, AWS/container detectors only, never the meta-package.
- TASK-049: the bcrypt decision is applied.

Related: [[project-p3-security-conditions]], [[project-security-review-conventions]]
