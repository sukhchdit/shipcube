---
name: project-p5-task042
description: TASK-042 (i18next + i18next-icu runtime, tools/i18n checker) r1 @b8ba7788 PASS_W_COND (35f8ef0a, D-SECPR042-01, PR-pending name); PR042-SEC-01 MEDIUM i18next GHSA-q76c-gcvw-89x9 repo advisory, bump to >=27.1.3 is C1; delta round owed
metadata:
  type: project
---

Round 1, 2026-11-21, pre-push. Record `docs/05-quality/security/PR-pending-TASK-042-security-review.md` + D-SECPR042-01 committed on main `35f8ef0a` (not pushed). Head row `b8ba7788`, base `530629f4`, 6 owned paths (root package.json + lock, packages/ui package.json + tsconfig, AT-US-115-01 lint fixture, negative-fixtures.test.ts). Code twin APPROVED_WITH_NITS `7f7dcf52` (m1 silent ICU format errors, m2 context.json, m3 JSX concat, m4 budget, n1-n6).

**Findings:** PR042-SEC-01 MEDIUM (CWE-1395): i18next 27.1.1 is inside GHSA-q76c-gcvw-89x9 (High, `< 27.1.3`, published 2026-11-16 as a REPOSITORY advisory, not in the reviewed global DB, so npm audit/OSV/bulk feed all said 0). Not reachable via createI18n (no backend, string fallbackLng, supportedLngs en/es/fr); reproduced with an async backend + `changeLanguage('hasOwnProperty')`. INFO 02 raw values (URL attrs, future `<Trans>` parses tags after ICU inserted values), 03 m1-fix logging constraints (no err.message/options; debug pinned off), 04 checker reads only top-level `{lng}/*.json` of 3 folders (subfolder/.JSON/app JSON/inline TS bypass), 05 `i18n:check` script body unpinned.

**Conditions:** C1 bump i18next (27.1.3 admissible from 2026-11-23T05:54Z; 27.1.5 11-24, 27.2.2 11-26) + version-floor test + DELTA ROUND (sim S7: the bump voids the binding). Dated acceptance if merge must precede: expires 2026-11-30, and before any i18next backend/detector/request-derived changeLanguage (TASK-062) or server-side i18next. C4: union with TASK-041 proven at `0614a90f` (disjoint keys); a main merge carrying TASK-041's lock voids the binding (S10) -> merge-only round.

**Facts:** i18next-icu 2.7.0 values = `{...options, ...options.replace}` then `fc.format`; i18next interpolation/`$t()` are bypassed (values never re-parsed); memo walker has the 2.4.4 UNSAFE_KEYS guard. i18next 27.1.1 prints nothing on init. i18next has a `prepare` script (inert for registry tarballs). Only the formatjs packages carry SLSA provenance. Checker CLI (`import.meta.main` under tsx) fails closed (exit 1 on findings, crash on bad JSON/BOM).

**Kit (session scratch `t042sec/probes/`):** registry.mjs (packument, signature, tarball hash, bulk + OSV with lodash control), p1-runtime.mjs + hooks.mjs (type-stripped ui i18n over the worktree node_modules), p2-checker.mjs (16 fixtures through the real CLI), p3-advisory.mjs, union.mjs, sim.mjs (11 scenarios), gl-nodigit.mjs.

Related: [[project-p5-task041]], [[project-p5-audit-effect-waiver]], [[project-security-review-conventions]]
