/**
 * commitlint configuration (Conventional Commits; CLAUDE.md §2 branching rules; TASK-002). Checked by
 * tools/lint/commitlint.test.ts; the CI hook that lints PR commits is added with the CI workflows.
 */
/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],
};
