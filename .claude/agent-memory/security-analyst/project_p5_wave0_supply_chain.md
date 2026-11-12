---
name: project-p5-wave0-supply-chain
description: PR-0001/TASK-001 review (2026-11-12) PASS_WITH_FOLLOW-UPS; non-obvious supply-chain facts (@platform scope third-party, Prisma engine download, bcrypt 18-month, elkjs SPDX) and what to check in TASK-003/004/007/014/049/214 reviews
metadata:
  type: project
---

PR #1 (TASK-001) review: `docs/05-quality/security/PR-0001-TASK-001-security-review.md`. Verdict **PASS_WITH_FOLLOW-UPS**. Open findings: 4 MEDIUM (all latent), 3 LOW, 4 INFO. IDs are PR1-SEC-01..11.

**Non-obvious facts. Re-verify them before relying on them.**
- **`@platform` npm scope.** It is a third-party org on npmjs.com (131 packages) and is our workspace scope (ADR-0002). The fix is `.npmrc` `@platform:registry=https://registry.invalid/`, verified to keep `npm ci`, `npm ls` and `npm audit` working. Any per-app install outside the workspace root is a dependency-confusion path (PR1-SEC-01).
- **Prisma engine download.** Prisma 7 CLI `generate`/`migrate`/`db`/`version` call `ensureNeededBinariesExist`, which downloads native `schema-engine` from binaries.prisma.sh. The only check is a SHA-256 from the same origin, and it can be skipped via `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING`. On the dev host the shared cache `%APPDATA%\Prisma\master\<hash>` masks this, so SPK-01's "generate works without install script" was cache-dependent (PR1-SEC-02).
- **`bcrypt`.** 6.0.0 (published 2025-05-11) crossed the 18-month rule on 2026-11-11. The brief fixes bcrypt, so principal-architect must decide (PR1-SEC-06).
- **`elkjs`.** The SPDX is plain `EPL-2.0`: Exhibit A is unfilled, so it is not "OR GPL". It arrives via prisma → @prisma/studio-core.
- **Studio is loaded eagerly.** Prisma `cli.js` requires `@prisma/studio-core/data/*` at module level, so a Studio-free migrate image likely needs a stub.
- **Unreachable advisories.** `gaxios` 7.1.3 never loads `rimraf`, so the glob/minimatch moderates are unreachable. `gcp-metadata` 8.1.4 pins gaxios exactly, which makes npm audit's `fixAvailable: true` misleading.
- **In-flight ADR edits.** On 2026-11-12, principal-architect's ADR amendments (ADR-0022 am. 11–13, ADR-0023 am. I, ADR-0026 am. 10, ADR-0017 am.) were uncommitted in the main tree. D-ARCH-003 rev 3 and D-ARCH-035..039 were referenced but not yet in DECISIONS.md.

**Why:** the binding requirements in review §6 are spread over later tasks, and the gates close only if each later review checks them.

**How to apply:** in P5 reviews, check these items:
- TASK-003: an engine-pin step in deps:rebuild, refusal of PRISMA_ENGINES_* variables, CHECKPOINT_DISABLE.
- TASK-004: a custom `app/entry.server.tsx` and no `isbot`.
- TASK-007:
  - the post-build `git status --porcelain` gate;
  - the `@platform` pin and link-only lockfile entries;
  - the elkjs, png-js and caniuse-lite licence handling;
  - that the freshness gate waits for the bcrypt and node-abort-controller rulings.
- TASK-014:
  - `--omit=dev --omit=optional`, installed from the workspace root;
  - no schema-engine, prisma, studio or elkjs in the api/worker images;
  - the migrate image tested.
- TASK-214: no GCP/Azure/Alibaba detectors.
- TASK-049: the bcrypt decision is applied.

Related: [[project-p3-security-conditions]], [[project-security-review-conventions]]
