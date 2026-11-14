---
name: project-p5-pr46-015b-lane-c
description: PR #46 (TASK-015 015-B lane C/nightly, security-integration, gitleaks-full runner, C-1 deletion) R1 @12ea6a6 PASS_WITH_FOLLOW-UPS; LOW 01-05 (supply-chain order, Playwright npm_config_ redirect, chain unpinned, filename-keyed no-release + global CKV_GHA_7, lane C static gaps); D-ORCH-077 fix cycle -> delta round; facts and kit
metadata:
  type: project
---

Record: `docs/05-quality/security/PR-0046-TASK-015B-security-review.md` written uncommitted into worktree `Shipqube-TASK-015B` on 2026-11-14 (LF). R1 head `12ea6a6647ad3b9e7aae48adfb24f37c0f428856`: **PASS_WITH_FOLLOW-UPS**, 0 C/H/M, LOW PR46-SEC-01..05, INFO -06..-10. Proposed D-SEC-PR46-01.

**Closed:** PR33-SEC-08, PR25-SEC-01 runner half, ADR-0005 am. 10 item 13 (spike + exemption + one-off ci.yml steps deleted in `8d83468`; `--print-config` on the old path: allow-list -> bare error).

**Open (routed):**
- 01 LOW: security-integration (`needs: [scans]`) runs `npm ci` + deps:rebuild + Jest before fast-lane's lockfile/cooldown/licence/signature/audit gates; `package-lock.json` is in its trigger list; Dependabot PRs #41/#16 change the lockfile. Fix: `needs: fast-lane` success or replicate base-ref gates. In the D-ORCH-077 fix cycle.
- 02 LOW: Playwright `getFromENV` also reads `npm_config_<name>` and `npm_package_config_<name>`; npm 11.19.1 exports unknown `.npmrc` keys and package.json `config` keys to `npm run` children; rebuild.mjs and policy regex anchor on `^PLAYWRIGHT_` (probe: dry-run lists mirror URLs). Before first hosted lane C dispatch.
- 03 LOW: required-gates pins only `ci-gate needs security-integration`; mutants C2 echo false, C3 base=head, C4 security_ok=true, C5 head manifests, C9 `|| true` pass base policy (C4/C5/C9 also head ci-policy.test toContain).
- 04 LOW: NO_RELEASE/DISPATCH_ONLY keyed on file names (`lane-c.yaml` rename, new `release.yml` = 0 findings), literal terraform image `apply` passes, `--skip-check CKV_GHA_7` global.
- 05 LOW: lane C `static` has no Semgrep/audit/osv/signatures/licences/lockfile/cooldown although ADR-0023 am. C says "everything in lane A".
- INFO 06 substring required-case match (`SEC-TC-050` satisfies `SEC-TC-05`); 07 tripwires (node cli.js install, secrets/persist-credentials in dispatch-only workflows); 08 trigger list vs future suites (tests/generated/**, jest.config.ts) for principal-architect; 09 iac (unanchored skip-path, xargs whitespace, module sources); 10 gitleaks-full wording/config-from-dispatched-ref/shifted-line test.

**Facts (probe-confirmed 2026-11-14):** gitleaks image v8.30.1 runs as root (no USER; `safe.directory '*'` baked in). Gitleaks `--log-opts "<flags> <sha>"` = `git log -p -U0 <flags> <sha>` (all ancestors; `--diff-merges=first-parent` only shapes merge diffs). Checkov 3.4.3 / Terraform 1.17.1 digests equal Docker Hub. upload-artifact v7.0.2 = `cf430e0`, download-artifact v8.0.2 = `9000827`. check-security-owned-paths `--json` = `{status, owned[], satisfiedBy{record,commit}, notes}`; reads records from `--root` working tree (worktree with an uncommitted record works read-only).

**Kit (session scratch `review/PR-46-sec/probes`, may vanish):** `policy-mut.mjs` (40 workflow mutants on head checkWorkflow), `hostscan.mjs` (count-only, needles from os), `gl-probe.mjs` + `gl-locked.sh` (lock waiter: mkdir lock, owner file, release), `record-sim.sh` (13 scenarios, clone --shared, main's checker).

**How to apply:** delta round after the D-ORCH-077 fix cycle: check record §6.2 six invariants (base-ref selection, fail closed, negative-only skip, no package code before supply-chain gates, base-ref manifest, policy pins), SEC-01/03/06 fixes, fresh evidence with D-SEC-PR23-02 wording; merges with #39 (package.json, check-workflow-policy(.test), rebuild.mjs) or #42 (eslint.config.mjs) void the record -> merge-only round against record §7.

Related: [[project-p5-pr33-lane-a-hardening]], [[project-p5-pr25-ci-followups]], [[project-p5-pr45-gitleaks-allow]], [[project-p5-pr10-ci-lane]], [[project-p5-pr39-task014-images]], [[project-security-review-conventions]]
