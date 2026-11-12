---
name: lint-probe-technique
description: How to predict lint breakage of one PR under another open PR's ESLint config, or probe a PR's own config, without installing (scratch config + basePath + createRequire)
metadata:
  type: reference
---

When a PR is likely to merge after the lint PR (TASK-002), you can predict its errors without installing anything. Write a scratch `eslint.config.mjs` that:
1. loads the plugins from the other worktree's node_modules with `createRequire('<other>/package.json')` plus `import(pathToFileURL(require.resolve(name)))`;
2. sets `basePath: '<PR worktree>'` on every config object, so files outside the scratch dir are not ignored;
3. copies only the rule blocks of interest, with `parser: tseslint.parser` and no type information. That keeps it light on memory.

Run it as `node <other>/node_modules/eslint/bin/eslint.js --no-config-lookup -c <scratch>/eslint.config.mjs <dirs>`, from the PR worktree.

Used on PR #4 (2026-11-12): it found 24 errors that the PR's own "lint exit 0" (old config) hid. Type-aware rules (require-await etc.) still have to be predicted by reading the code.

**Why:** parallel PRs each pass lint against the old main config, so the merge-second PR breaks.
**How to apply:** use it for any PR in the same batch as a lint-config PR. Put scratch files under a reviewer-unique dir (see [[scratch-copy-technique]]).

**Untyped probes miss type-aware breakage (PR #4 r2).** Main's config applies `recommendedTypeChecked` to every `.ts`/`.tsx` file, tests included. Grep the delta for `as X` casts and for `./+types/` route imports. Lint without `.react-router/` sees `Route.*` as error types, which produces `no-unsafe-*` errors. Confirm suspects with the junction-free typed probe ([[scratch-copy-technique]]).

**Lighter variant for probing a PR's OWN config (PR #2 r2, 2026-11-12):**
- No archive copy or junction is needed.
- Put a probe root (a miniature repo: `apps/api/src/modules/...`) in the scratch dir.
- Write a script that loads `eslint` and `typescript-eslint` via `createRequire('<worktree>/package.json')`.
- Call `new ESLint({ cwd: probeRoot, overrideConfigFile: '<worktree>/eslint.config.mjs', overrideConfig: [disableTypeChecked, {projectService:false}, {rules: no-unresolved/no-extraneous off}, {settings:{'boundaries/root-path': probeRoot}}] })`.
- Pass Windows paths (`pwd -W`). It takes about 10 s.
- `@platform/*` imports do not resolve there, so they classify as external. That is useful for testing the external arm of a policy.
