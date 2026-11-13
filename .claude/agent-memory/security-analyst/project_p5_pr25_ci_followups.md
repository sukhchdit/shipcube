---
name: project-p5-pr25-ci-followups
description: PR #25 (TASK-007 follow-ups: drop OpenAPI gitleaks allowlist, Dependabot typescript-major ignore) R1 @20a0fc6 PASS_WITH_FOLLOW-UPS; PR10-SEC-08 closed; PR25-SEC-01 LOW 17-fingerprint baseline owed before gitleaks-full; real-image gitleaks facts
metadata:
  type: project
---

The PR #25 review is `docs/05-quality/security/PR-0025-TASK-007-fu-security-review.md` (uncommitted in main when written, 2026-11-13). R1 head `20a0fc689abdd74311079e2f81a7204bc18047f1`, PASS_WITH_FOLLOW-UPS.
- **Closed:** PR10-SEC-08 (LOW) and the OpenAPI part of PR1-SEC-11.
- **New:**
  - PR25-SEC-01 (LOW): the 17 historic hits need an exact-fingerprint `.gitleaksignore` before `gitleaks-full` activates and before G3. Owners TASK-015 and qa-lead. The exact list is in the record §3.2.
  - PR25-SEC-02 (INFO): guard-test blind spots (a `[[rules]]` override passes the suite; the Dependabot case is a text regex, so a misplaced ignore or a deleted `@platform/*` ignore passes). TASK-015.
  - PR25-SEC-03 (INFO): the `EXAMPLE_` marker rule is not in the API README. api-designer.

**Facts verified with the real v8.30.1 image (re-verify before relying on them):**
- **Old allowlist weakness reproduced.** The old OpenAPI allowlist (global `[[allowlists]]`, AND, path + line regex) hid a JWT, a GitHub PAT and an `sk_live_` key under `*_token` keys. The new config reports all three. The same lines in any other file were caught under both configs.
- **Historic hits:** 17 on first-parent history with the new config (14 in `b8f805f`, 1 in `d5cdfa2`, both openapi.yaml; 2 in `63accea` docs), 2 with the old config. `--all` adds 3 from the superseded, unmerged PR #11 and #13 branches (`d68898a`, `e6ccf60`). All 17 are non-credentials (ES256 JWT shapes with only `sub` and a 12-char signature).
- **`.gitleaksignore`:** fingerprint = `<40-hex commit>:<path>:<rule>:<line>`. With `--gitleaks-ignore-path /ign/.gitleaksignore` and the 17 lines: 0 findings. With 16 lines: exactly the omitted one. With every line shifted by one: all 17. So it is exact. Lane A's `.git`-only mount cannot load it, which is by design.
- **`[[rules]] id = "jwt"` + blanket `[[rules.allowlists]]`** silences the `jwt` rule in the real image (the same line then shows as `generic-api-key` only because of its key name). `sec-static.test.ts` still passes 12 of 12.
- **TypeScript:** the registry has no 6.1 (6.0.3 is the last 6.x; `latest` is 7.0.2). typescript-eslint 8.72.x peers `typescript <6.1.0`.
- **Dependabot file validation:** parse with the `yaml` package from the main checkout. Validate against `https://json.schemastore.org/dependabot-2.0.json` with Ajv `strict:false`. Add two invalid-file controls.
- **Merge of main and the record:** main moved three times during the review, and PR #23 changed owned paths (`ci.yml`, CODEOWNERS, `package.json`, `tools/ci/check-workflow-policy.*`). The record stayed valid in the simulation because the main-side owned paths and the PR's three owned paths do not intersect (clause (d) intersects with the PR's own net change). The orchestrator's `.github/workflows` check against a moved main must use the three-dot form.

**Why:** the baseline is the one follow-up that can bite later. The `gitleaks-full` suite is zero-skip and `gate`-profile, and history cannot be rewritten, so the temptation will be a broad `.gitleaks.toml` allowlist, which would re-open PR10-SEC-08.

**How to apply:**
- **TASK-015 review:**
  - the runner mounts the baseline from the base or gate ref and scans the gate SHA's ancestry, not `--all`;
  - an integration test covers 17 lines (0), 16 lines (1) and shifted lines (all);
  - `sec-static` parses Dependabot structure and rejects `[[rules]]` and `[allowlist]` tables.
- **First monthly Dependabot run:** no `typescript` 7.x PR; #15 closes; no `private_source_not_reachable`.
- **Any PR touching `openapi.yaml`** is now scanned with no contract allowlist.
- **Host tooling:**
  - Git Bash with `MSYS_NO_PATHCONV=1` passes `/c/...` paths to native exes unconverted, so use `cygpath -m` for git, node and tar.
  - With `NO_PATHCONV=1` use `cmd /c mklink /J`, not `cmd //c`.
  - `docker.lock` can be held 10 to 15 minutes by a gates run, so queue the scans as background batches that acquire the lock per container.

Related: [[project-p5-pr10-ci-lane]], [[project-p5-pr21-openapi-pipeline]], [[project-p5-pr23-lane-b]], [[project-security-review-conventions]]
