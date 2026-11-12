---
name: project-p5-wave0-web-scaffolds
description: PR-0004/TASK-004 web+admin scaffold review (2026-11-12) PASS_WITH_FOLLOW-UPS at 519bb89; harness delta re-review owed; non-obvious nginx/Vite/React Router facts and what TASK-014/022/111/007/005 reviews must check
metadata:
  type: project
---

PR #4 (TASK-004) review: `docs/05-quality/security/PR-0004-TASK-004-security-review.md`. IDs are PR4-SEC-01..09 (3 LOW, 6 INFO). Verdict PASS_WITH_FOLLOW-UPS at `519bb89`. PR1-SEC-03 is met for TASK-004 and remains open only for its TASK-007 (b/c) and TASK-014 (d) parts.

**Still owed:** a delta re-review (R2) of the Playwright/axe harness commit before merge. Check:
- the lockfile tuples and their age at commit time;
- that the install did not happen before 2026-11-12T20:17:41Z. `playwright-core` 1.65.0 was published 2h after `@playwright/test`, and `playwright` pins it exactly;
- the `decodeURIComponent` try/catch in the static server.

**Non-obvious facts. Re-verify them before relying on them.**
- **Vite 8 inlining.** Whole-object `import.meta.env`, including via a TS cast like `(import.meta as X).env`, inlines **all** `config.env` `VITE_*` keys (`vite/dist/node/chunks/node.js` `generatePattern`). The fix is `envPrefix: 'VITE_PUBLIC_'` or a static key read.
- **`config/web` has no owner task.** ADR-0018's `config/web` module (Zod, `define`, non-secret test) appears in no task sheet. Routed to principal-architect, with TASK-005 suggested.
- **React Router meta.** The `Meta` component keeps only the deepest route's array, with no merge. Any "always present" tag, such as robots, must sit statically in `Layout` `<head>`.
- **nginx-unprivileged `default.conf`.** It ships `conf.d/default.conf` (`server_name localhost`, IPv6 listen). Unless TASK-014 deletes it, it shadows our templates. For web it shadows every request, because `default.conf` sorts before `web.conf`. For admin it shadows `Host: localhost`.
- **Template comments are wrong on ownership.** They say TASK-022 owns the Dockerfile and header suite. Actually TASK-014 owns the Dockerfiles and TASK-111 (US-043) owns the headers, Permissions-Policy and HSTS.
- **`isbot` 5.2.2 in the lockfile is normal.** It is a transitive dev dependency of `@react-router/dev`. Only manifest declarations matter.

**Why:** the follow-ups land in later tasks, and the gates close only if each later review checks them.

**How to apply:** check these items in later P5 reviews:
- **TASK-014:**
  - `rm conf.d/default.conf` and clean the html root;
  - copy `build/client/` only, never `build/server/`;
  - an `nginx -T` single-server test;
  - a `Host` variation test;
  - `NPM_CONFIG_OFFLINE` plus the manifest checksum guard.
- **TASK-022:** the CSP must cover 4 classic + 1 module inline scripts per page, and the SPA fallback has a different hash set.
- **TASK-111:** both images, including a non-matching `Host`.
- **TASK-007:** rejection of `PLAYWRIGHT_DOWNLOAD_HOST`; `nanospinner` 1.2.2 in the freshness report (report-only); gitleaks on the PR #4 range.

Related: [[project-p5-wave0-supply-chain]], [[project-security-review-conventions]]
