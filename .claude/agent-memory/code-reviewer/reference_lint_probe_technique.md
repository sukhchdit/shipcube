---
name: lint-probe-technique
description: How to predict lint breakage of one PR under another open PR's ESLint config without installing anything (scratch flat config + basePath + createRequire)
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
