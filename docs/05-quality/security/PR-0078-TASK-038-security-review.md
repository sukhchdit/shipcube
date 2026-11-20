# PR-pending: TASK-038 (design tokens, token lint, tenant override seam), security review

**File name.** The PR does not exist yet. Once it does, the orchestrator renames this file on main, with `git mv` in a docs-only commit, to `docs/05-quality/security/PR-<NNNN>-TASK-038-security-review.md`, where `<NNNN>` is the PR number zero-padded to 4 digits. The content stays as it is. Main's `check-security-owned-paths.mjs` counts only `PR-<NNNN>-*.md` records for PR `<NNNN>`, so under the pending name this record satisfies nothing. Order (D-ORCH-136, D-ORCH-138): open the PR as a draft, rename the record on main, confirm that the PR's merge ref contains the renamed record (`git fetch origin refs/pull/<n>/merge`, then `git ls-tree`; its first parent must be the rename commit or later), then mark the PR ready.

| Field | Value |
|---|---|
| PR | Not opened yet. Branch `feat/TASK-038-design-tokens-compiled-tailwind-4`, one commit on main `f9cc7ca1` |
| Head | b7482fb8eeb417c9513ea4af4449d45770ba026c |
| Lane A evidence | None: the branch is not pushed. Main's classifier (`tools/ci/security-paths.mjs --base f9cc7ca1 --head b7482fb8`) gives `security_paths=false` (30 changed paths), so the hosted `security-integration` job does not run. `LINT_CONTROLS` is true (the Stylelint config, the rule, the fixtures and root `package.json` match `LINT_CONTROL_PATHS`), so lane A's base-ref no-weakening fixture step runs |
| Lane B evidence | None read by me. The code-review twin (`docs/05-quality/reviews/PR-pending-TASK-038-code-review.md`, APPROVED_WITH_NITS, merge condition C1) reports 187 TASK-038 unit tests and the exact and no-weakening fixture runs on an extract |
| Owned paths changed | 16, as main's checker counts them (`--base f9cc7ca1 --head b7482fb8`): root `package.json` (one script, `tokens:build`), `stylelint.config.mjs`, `tools/stylelint-rules/token-lint.mjs`, `tools/lint/negative-fixtures.test.ts` (7 cases, 1 clean case, 1 completeness line), and 12 files under `tests/fixtures/lint/css/` (8 new, 4 edited). So this record is a merge condition (twin C2) |
| Unowned paths changed | 14: `tools/ui/**` (8: compiler core, CLI, token-lint analysis, 5 tests), `packages/ui/tokens/**` (2), `packages/ui/src/theme.css`, `packages/ui/src/theme/tokens.generated.css`, `apps/{web,admin}/app/theme.test.ts` |
| Binding items checked | The TASK-038 brief and card; US-101; `tokens.md` §1 rule 4 and §11 (D-UX-002) and `tenantOverrideRule`; ADR-0002 §5 (Stylelint, disable-comment policy, PR2-SEC-03); `.github/CODEOWNERS`; the ci.yml base-ref fixture step (PR2-SEC-08, D-ORCH-018); main's `tools/ci/lane-scope.mjs` (`LINT_CONTROL_PATHS`, `PROOF_BASE_DIRS`); `platform.md` CSP (hash-based, `style-src 'self'`); PR4-SEC-13 (typegen runs unowned code before Stylelint); D-TASK038-06 as cited by the orchestrator and ruled by the twin; twin R1-m3 and its §7 security flags |
| Reviewer / date | security-analyst, 2026-11-20, round 1, pre-push. Host rule: no npm, Jest, type-check, build or Docker, and nothing in the evidence worktree `../Shipqube-TASK-038` (not touched, not even read-only git; the branch was read with `git show` / `git archive` from the main checkout). Method: static review plus single-process Node 24 probes on `git archive` extracts of `b7482fb8` and `f9cc7ca1`, using the real Stylelint 17.16.0 API and CLI from the main checkout's `node_modules` (the lockfile is unchanged) |

## 1. Summary

- **The gate edits do not weaken any existing lint control.**
  - Effective configuration, head against base, over 19 paths: the only change is `platform/token-lint`. It is on everywhere except the one generated file. Every other rule and the three `report*Disables` flags are equal to the base on all 19 paths. Two mutation controls were visible.
  - No `stylelint-disable` of the new rule exists anywhere, and `.stylelintignore` is unchanged.
  - The four fixture edits are neutral. In my exact-mode replica, each bad fixture reports exactly its own rule. In the base-ref replica (base fixtures against the head config), 0 expected findings are missing, and the 4 extras all carry a rule id, which no-weakening mode allows. The repository's own CSS lints clean.
- **The new rule's logic lives outside the owned tree (PR038-SEC-01, LOW; twin R1-m3 (2)).** The owned rule imports its analysis and vocabulary from unowned `tools/ui/**`, and that code runs inside the Stylelint gate process. Two unowned-only mutants show the effect:
  - one makes `stylelint "**/*.css"` exit 0 over four findings from all three rules, while the fixture suite stays green;
  - the other drops `oklch()` from the refused shapes, and no owned control notices.
- **The "off" override is exact today, but no test pins it (PR038-SEC-02, INFO; twin R1-m3 (1)).**
- **Tenant override builder.** The allow-list matches exact own keys from a `Set`. `__proto__`, `constructor`, whitespace and case variants are refused. Only 3- and 6-digit hex values pass: a fuzz over all 1,112,064 Unicode scalar values accepted only the 22 ASCII hex digits in a digit position. Alpha is never accepted. Contrast is enforced per theme over the declared pairs, and every overridable token appears in at least one pair. The output alphabet over 4,000 random overrides holds no `<`, `\`, `/` or `"`.
  - One gap: the value is checked by string coercion but used through a method call. A JSON array crashes the build, and a JS object with forged methods injects CSS (PR038-SEC-03, LOW).
- **Concerns for the runtime port.** These do not matter while the only callers are tests:
  - the documented `<style>` delivery conflicts with the planned CSP (PR038-SEC-04, INFO);
  - rejection reasons echo the raw value without a bound (PR038-SEC-05, INFO).
- **Lint-time ReDoS.** The token-lint quoted-string stripper backtracks super-linearly. It fails closed, and only repository authors can reach it (PR038-SEC-06, INFO).
- **No new dependency.** `package-lock.json` and every workspace manifest are unchanged. `tailwindcss` 4.3.4 (both apps) and `jest-environment-jsdom` 30.5.2 (root) were already declared. Every import in the changed code is a `node:` built-in, `stylelint`, `tailwindcss`, `@jest/globals` or a repository file.
- **Generated CSS.** 16,390 bytes with no `url(`, `@import`, `@font-face` or URL scheme. The only non-ASCII characters are three section signs in comments. The fonts are system stacks. The CSS ships in the app's same-origin bundle, so it works with `style-src 'self'` and needs no inline style.
- **Secrets.** An over-approximating scan of the 2,605 added lines used the pinned v8.30.1 rules (220 compiled; both runtime positive controls fired). It found 5 `generic-api-key` regex candidates. All are below the rule's 3.5 entropy and contain no digit, so the real rule cannot fire.

No Critical, High or Medium finding. **Verdict: PASS_WITH_FOLLOW-UPS.** D-TASK038-06 is accepted with the port conditions in §4.

## 2. Findings

### PR038-SEC-01 · LOW · The owned `platform/token-lint` rule runs unowned code inside the Stylelint gate process

| | |
|---|---|
| CWE / OWASP | CWE-829 Inclusion of Functionality from Untrusted Control Sphere (CWE-693) · A08:2021 Software and Data Integrity Failures |
| Where | `tools/stylelint-rules/token-lint.mjs:11-12` imports `tools/ui/token-lint.mjs` and `tools/ui/tokens-core.mjs`. Lines 29-31 read `packages/ui/tokens/tokens.json` at config load. `.github/CODEOWNERS:37-40` does not list `tools/ui/`, and neither does main's `tools/ci/lane-scope.mjs` in `PROOF_BASE_DIRS` (line 123) or `LINT_CONTROL_PATHS` (line 139) |
| Twin | Code review R1-m3 (2), MINOR |

**Description.** Before this PR, every module the Stylelint process loaded was owned: the config, `tools/stylelint-rules/` and dependencies pinned by the lockfile. `eslint.config.mjs` follows the same convention and imports only `tools/eslint-rules/` and `tools/lint/`. Now config load also evaluates two unowned modules. A PR that changes only `tools/ui/**`:

- needs no security record;
- does not set `LINT_CONTROLS`, so lane A skips the base-ref no-weakening fixture step;
- does not void a proof run.

Only the head suite's exact mode still runs, and it notices only the 7 seeded shapes.

**Probes.** Run on extracts with the real Stylelint CLI and API. The violating stylesheet is `apps/web/app/*.css` with a physical margin, an off-grid length, a named colour and a bare `:hover`.

| Case | `stylelint "**/*.css" --max-warnings 0` exit | Findings through the API (what `lint-fixtures.mjs` reads) | Owned negative fixtures |
|---|---|---|---|
| Control: head tree | 2 | 4 (`csstools/use-logical`, `platform/hover-in-media`, `platform/token-lint` x2) | All 7 token cases fire |
| **M1:** two lines appended to unowned `tools/ui/tokens-core.mjs`, `process.on('exit', () => { process.exitCode = 0; })` | **0** | 4, unchanged | Unchanged, so the suite stays green |
| **M2:** `hsl`, `hsla` and `oklch` dropped from `COLOUR_FUNCTION` in unowned `tools/ui/token-lint.mjs` | n/a | `hsl()` and `oklch()` no longer reported | `bad-token-hsl-colour.css` goes clean, so the exact suite fails (caught). **The `oklch` drop is not noticed by any owned case** |

M1 silences the whole Stylelint step of `npm run lint`: all three rules and the disable-comment reporting. The unit suite stays green, because the harness reads findings, not the exit code.

**Exploitability and impact.** This needs an insider, an agent author or an accident. It has no runtime effect: the impact is the loss of lane A's Stylelint controls (NFR-I18N-003, NFR-A11Y-006, US-101). A mitigating fact is PR4-SEC-13 (INFO, accepted). `npm run lint` already evaluates unowned `react-router.config.ts` and `routes.ts` through typegen before Stylelint, so a deliberate attacker had an equivalent lever. What is new is the direct path and the accidental one: an innocent vocabulary edit in `tools/ui` narrows an owned rule beyond the 7 pinned shapes. Impact M x likelihood L = **LOW**.

**Remediation.** Choose one of:

- **(a), preferred.** Add `/tools/ui/                              @sukhchdit` to `.github/CODEOWNERS` under "Static-analysis controls", with a comment naming PR038-SEC-01. In main's `tools/ci/lane-scope.mjs`, add `tools\/ui\/` to the `LINT_CONTROL_PATHS` alternation and `'tools/ui/**'` to `PROOF_BASE_DIRS`, and update both pinned tests.
- **(b).** Move the analysis (`tools/ui/token-lint.mjs`) and the vocabulary entry point under `tools/stylelint-rules/` (for example `tools/stylelint-rules/lib/`). The compiler then imports from there.

In either case, pin the rest of the refused vocabulary in owned fixtures. Add one bad fixture each for `oklch()`, `rgba()`, an 8-digit hex, a named colour in the `border` shorthand and an `em` length in `gap`, plus whatever R1-m2 closes.

**Verification.**

- With (a), a PR that touches only `tools/ui/token-lint.mjs` is listed by `check-security-owned-paths.mjs` and gets `lint_controls=true` from `lane-scope.mjs`.
- With the new fixtures, mutant M2 turns `bad-token-oklch-colour.css` clean, and the exact suite fails.

**Owner and due date.** senior-developer (fixtures, or the move) and devops-engineer (CODEOWNERS, `lane-scope.mjs`). In this PR if a fix cycle happens anyway; otherwise before the next PR that changes `tools/ui/**`, and at the latest before TASK-046 merges. TASK-046 adds a Stylelint rule beside this one (twin ruling on D-TASK038-08). The CODEOWNERS and `tools/ci/` edits are owned paths, so they need a security round.

### PR038-SEC-02 · INFO · The `platform/token-lint` "off" override is exact today, but no test pins it for repository paths

| | |
|---|---|
| CWE / OWASP | CWE-693 Protection Mechanism Failure · A05:2021 Security Misconfiguration |
| Where | `stylelint.config.mjs:26`. In `tools/lint/lint-fixtures.mjs`, `configEvidence` reports only Stylelint ignore decisions, and `effective` covers ESLint only |
| Twin | Code review R1-m3 (1), MINOR |

**Probe.** I ran `stylelint.resolveConfig` over 19 paths at head and base.

- `platform/token-lint` is off only for `packages/ui/src/theme/tokens.generated.css`.
- It is on for every near miss: `x-tokens.generated.css`, `tokens.generated.css.bak.css`, the same name at other depths and under `apps/web/`, case variants, a dot-prefixed name, and the fixture directory.
- Every other rule and the three report flags equal the base on all 19 paths.
- Mutation controls: a widened `files: ['**/*.css']` was visible on 17 of the 17 eligible paths, and `platform/hover-in-media: null` on 19 of 19.

**Why INFO.** The file is owned, so any widening already needs a record. A pin only removes the reliance on reviewer attention. Fixture linting does not catch a targeted widening (for example to `packages/ui/**` or `apps/**`), because it runs with the fixture directory as cwd and the override is relative to the config.

**Remediation.** As twin R1-m3 (1) proposes:

- In `configEvidence`, lint the code `a { color: #ff0000; }` with `codeFilename` set to `packages/ui/src/theme.css`, `apps/web/app/app.css` and `packages/ui/src/theme/other.css`, and expect `platform/token-lint` each time.
- At the generated path, expect no finding.
- Assert both in the always-run (weakening) half of the suite.

**Verification.** Widening the override to `packages/ui/**` makes the suite fail in both modes. Owner: with PR038-SEC-01.

### PR038-SEC-03 · LOW · `buildTenantOverrideCss` checks the value by string coercion and uses it through a method call

| | |
|---|---|
| CWE / OWASP | CWE-1287 Improper Validation of Specified Type of Input (CWE-20) · A03:2021 Injection |
| Where | `tools/ui/tokens-core.mjs:447` (`HEX_COLOUR.test(value)` applies ToString), `:448` (`value.toLowerCase()`), interpolated at `:465` |

**Probe.** All overrides target `theme.light.action.primary.bg`.

| Input | Result |
|---|---|
| JSON `["#0b5d2a"]`, and nested `[["#0b5d2a"]]` | The regex passes on `String(array)`, then `TypeError: value.toLowerCase is not a function`. The whole call throws, so the other tokens' overrides are lost too |
| JS object `{ toString: () => '#0b5d2a', toLowerCase: () => '#0b5d2a; } html { display: none' }` | **Applied.** The emitted CSS contains `} html { display: none;` |
| A number, a boolean, `null`, `{}` | Rejected |
| 12 malformed strings: newline before or after, leading and trailing space, `;`, `}`, `/*`, 8 and 4 hex digits, no `#`, the injection string, NUL | Rejected by the format check. Upper-case hex is accepted and lower-cased; `#fff` is well-formed and rejected by contrast (white text on a white primary) |

**Reachability today.** None. Tests are the only callers. `tokens.md` §11 plans operator configuration (`BRAND_PRIMARY_*`), and D-TASK038-06 says the seam becomes tenant-controlled later. From JSON-only input, the effect is a thrown TypeError: fail closed, but a crash or a 500. Injection needs a JS-level caller that passes a non-string, such as a mapping layer or a loader that hands objects through.

**Remediation (code).**

```js
for (const [token, value] of Object.entries(overrides)) {
  if (!allowed.has(token)) rejected.push({ token, reason: 'not tenant-overridable' });
  else if (typeof value !== 'string' || !HEX_COLOUR.test(value)) rejected.push({ token, reason: 'not a #rgb or #rrggbb colour' });
  else byMode[/** @type {Mode} */ (/** @type {FlatToken} */ (flat.get(token)).path[1])][token] = value.toLowerCase();
}
```

The new reason text also closes PR038-SEC-05's echo.

**Verification.** In `tools/ui/tenant-override.test.ts`, the array, the forged object and `new String('#0b5d2a')` are each rejected without a throw, and `css` is `''`.

**Owner and due date.** This PR, if a fix cycle happens anyway. The file is unowned, so no new security round is needed. Otherwise the fix is mandatory before any runtime caller exists (§4, port condition (i)).

### PR038-SEC-04 · INFO · The documented seam allows "a stylesheet or `<style>`", but the planned CSP refuses a `<style>` element

| | |
|---|---|
| CWE / OWASP | CWE-693 Protection Mechanism Failure · A05:2021 Security Misconfiguration |
| Where | `packages/ui/src/theme.css:11-15`; `tools/ui/tenant-override-dom.test.ts:24-30` (mounts through `<style>`, test-only); `docs/03-architecture/platform.md:288` (hash-based CSP, `style-src 'self'; style-src-attr 'unsafe-inline'`) |

**Description.** The pages are static and pre-rendered, so a per-tenant `<style>` body cannot be hashed at build time. A `<style>` delivery therefore either fails in the browser (the default theme stays, which is safe) or pushes someone to add `'unsafe-inline'` to `style-src`. With `'unsafe-inline'`, any later HTML-injection point also gains CSS injection.

**Remediation.**

- Deliver the builder's output as a same-origin stylesheet, never inline. Two ways:
  - `<link rel="stylesheet">` from `/brand/`, the operator-mounted path that `platform.md` already serves;
  - or an API route with `Content-Type: text/css; charset=utf-8`, `X-Content-Type-Options: nosniff` and a per-tenant cache key.
- `style.setProperty` per validated variable is not governed by `style-src`. It loses the per-theme scoping, though, so it suits a single theme only.
- Drop "or `<style>`" from the `theme.css` comment.

**Verification.** An e2e run with the production CSP header: the override applies, and no CSP violation is reported.

**Owner.** The brand-configuration task (§4, port condition (iii)). The comment fix goes into this PR if a fix cycle happens anyway.

### PR038-SEC-05 · INFO · Rejection reasons echo the raw value without a bound

| | |
|---|---|
| CWE / OWASP | CWE-117 Improper Output Neutralization for Logs, CWE-770 · A09:2021 Security Logging and Monitoring Failures |
| Where | `tools/ui/tokens-core.mjs:447` (`"${value}" is not a #rgb or #rrggbb colour`), `:459` |

**Probe.** A 1 MiB value on an allowed key returned a 1,048,610-character reason. 20,000 unknown keys returned 20,000 rejections in 12 ms, with no cap.

**Impact.** None today. `tokens.md` §11 says a failing override is logged, so once the seam is ported, raw tenant text would reach logs and responses with no bound.

**Remediation.**

- Use a reason without the value (the PR038-SEC-03 snippet).
- At the boundary, cap the schema: allow-listed keys only, at most 16 keys, value length at most 7.
- Log only `{ token, reasonCode, pair }`.

**Owner.** §4, port condition (iv).

### PR038-SEC-06 · INFO · Super-linear regex in token-lint's quoted-string stripper (lint time)

| | |
|---|---|
| CWE / OWASP | CWE-1333 Inefficient Regular Expression Complexity · A04:2021 Insecure Design |
| Where | `tools/ui/token-lint.mjs:57`, `(["'])(?:\\.|(?!\1).)*\1`. A backslash matches both alternatives, so an unterminated quote followed by a run of backslashes backtracks in Fibonacci fashion |

**Probe.** I ran the real Stylelint API (postcss accepts a quote inside an unquoted `url(...)`) on the declaration `background-image: url(x"` + n backslashes + `)`:

- n = 28: 38 ms; n = 30: 85 ms. That is about x2.2 per +2, which extrapolates to minutes near n = 50 and hours near n = 60.
- The function on its own: n = 24 took 2.1 ms, n = 26 took 6.6 ms.
- Control: a terminated string of 100,000 backslashes took 1.0 ms.

**Impact.** A committed CSS line hangs `npm run lint` and the fixture harness until the job times out. That fails closed and bypasses nothing, and only repository authors can reach it.

**Remediation.** `value.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/gu, '""')`. Each character then has exactly one parse, and a backslash always escapes the next character, as in CSS.

**Verification.** 5,000 backslashes after an unterminated quote finish within 50 ms, and time(8k)/time(1k) < 16.

**Owner.** With the token-lint follow-ups (twin R1-m2).

## 3. Checked with no finding

- **Stylelint configuration.** The plugin list adds only the new rule. `reportNeedlessDisables`, `reportInvalidScopeDisables` and `reportDescriptionlessDisables` are unchanged. `.stylelintignore`, `tools/lint/check-suppressions.mjs`, `tools/lint/lint-fixtures.mjs` and the CI workflow are unchanged. The override object switches off `platform/token-lint` only.
- **Exact-mode replica** (head fixtures, head config, cwd = fixture directory, as `lint-fixtures.mjs` runs it):
  - each of the 14 bad fixtures reports exactly one rule, except `bad-invalid-scope-disable.css`, which reports its two expected disable reports;
  - `ok-logical-and-hover.css` and `ok-tokens.css` are clean.
- **No-weakening replica** (base fixtures and base config as the reference, base fixtures against the head config): 0 missing findings, comparing rule, severity and message.
  - The 4 extras are `platform/token-lint` errors on the base copies of `bad-hover-outside-media`, `bad-hover-wrong-media`, `bad-invalid-scope-disable` and `ok-logical-and-hover`.
  - All 4 carry a rule id, so lane A's step passes. The twin's real base-suite run logged the same 4 extras.
- **The four fixture edits** (`blue`/`#fff` replaced by `var(--color-…)`). Each one only removes a new token-lint finding that exact mode would otherwise count. The `:hover` selectors and the `color-no-invalid-hex` directive are untouched, and so are their messages.
- **Repository CSS against the head config** (cwd = root, `**/*.css`, `.stylelintignore` honoured): 4 files linted (`apps/{web,admin}/app/app.css`, `theme.css`, the generated theme), 0 warnings. The fixtures are ignored, as before.
- **`tokens:build`.** It is not a lifecycle, `pre` or `post` name, it runs only on demand, and lane A never calls it. The drift test runs in the `unit` project (`**/*.test.ts` under `tools`) and compares the committed file byte for byte.
- **Tenant builder.**
  - Rejected keys: `__proto__` (a `JSON.parse` own key), `constructor`, `toString`, the allowed key with a trailing space or newline, the upper-cased key, a primitive.
  - The mode is derived from the allow-listed token's own path.
  - A dark override is written under both the dark and the system scope. A light override cannot leak into dark: the dark scopes are more specific (twin §2).
- **Hex grammar and alpha.** In the per-code-point fuzz, only `0-9A-Fa-f` passed. `hexToRgb` ignores alpha: a widened grammar would let `#2563eb00` (fully transparent) pass at 5.17:1 against white. Hence port condition (ii).
- **Contrast.** Each of the 16 `tenantOverridable` tokens is named by 1 to 3 declared pairs of its mode. Over 4,000 random single overrides, 1,572 were applied and 2,428 rejected. The output alphabet was the selector and declaration characters only: no `<`, backslash, `/`, double quote, `url(` or `@import`.
- **State of main** (tip `8281055c` when this round was written). The commits since `f9cc7ca1` (PR #77 and docs) share no path with this PR, and `git merge-tree` is clean. PR #77 changed `tools/lint/carrier-wire-boundary.test.ts`, which this PR does not touch, so the record is not voided.

## 4. D-TASK038-06 ruling and port conditions

**Accepted.** The tenant override stays a build-time seam in `tools/ui`, and no runtime caller exists in this PR. No task in the plan names `BRAND_PRIMARY_*` loading or tenant theming yet; principal-architect assigns the owner. Whichever task first loads `BRAND_PRIMARY_*` or tenant theme values at runtime (`tokens.md` §11) carries these conditions:

- **(i) Boundary schema (Joi).** Keys must be exactly the allow-listed token paths, and any other key is refused, `__proto__` included. Each value is a string matching `^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$`, at most 16 keys. The builder also keeps its own `typeof` check (PR038-SEC-03).
- **(ii) Opaque colours only.** No 4- or 8-digit hex, `rgb()`, `color()` or named colours, unless the contrast test composites alpha over the real background and handles the colour space.
- **(iii) Delivery.** The CSS is a same-origin stylesheet built only from the builder's output (PR038-SEC-04). No `<style>`, and no `'unsafe-inline'` in `style-src`.
- **(iv) Contrast gate.** It runs on the server at write time and at load. A rejection applies per theme, and the default stays. Logs and API errors name the token and the failing pair, never the raw value, and their size is bounded (PR038-SEC-05).
- **(v) Tenant binding.** The override is selected from the authenticated organisation context or the server-side host mapping, never from a client-supplied tenant id or query parameter. Cache keys include the tenant. A write needs an RBAC permission and is audited with old and new values. The generated RBAC matrix and the RLS suites cover it.
- **(vi) Start-up assertion.** Every `tenantOverridable` entry is an existing `theme.<light|dark>.*` colour token named by at least one contrast pair of its mode (twin R1-n3).

## 5. Residuals and next steps

- Still owed: lane A on the pushed head, lane B (twin C1), and the rename plus the merge-ref check (D-ORCH-136/138).
- A new security round is needed only if an owned path changes after `b7482fb8`. That includes folding PR038-SEC-01 (a) or PR038-SEC-02 into this PR. The PR038-SEC-03 code fix and the `theme.css` comment are unowned and need no round.
- The probes were single-process Node runs on extracts. I ran no Jest, no build and no Docker. The real lane A gates have not run on this head.

| Field | Value |
|---|---|
| Verdict | PASS_WITH_FOLLOW-UPS. No Critical, High or Medium finding. LOW PR038-SEC-01 and PR038-SEC-03, INFO PR038-SEC-02 and PR038-SEC-04..06, all routed; D-TASK038-06 accepted with port conditions (i)-(vi) |
