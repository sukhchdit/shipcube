/**
 * Stylelint rule `platform/hover-in-media` (NFR-A11Y-006, ADR-0002 §5): `:hover` styles apply only inside
 * `@media (hover: hover)`, so touch devices never get sticky hover states. A rule containing `:hover` is accepted when
 * any ancestor is an `@media` at-rule whose query requires `(hover: hover)`; `not (hover: hover)` and
 * `(hover: none)` do not count.
 */
import stylelint from 'stylelint';

const {
  createPlugin,
  utils: { report, ruleMessages, validateOptions },
} = stylelint;

export const ruleName = 'platform/hover-in-media';

export const messages = ruleMessages(ruleName, {
  rejected: (selector) => `Unexpected ":hover" in "${selector}" outside "@media (hover: hover)"`,
});

const HOVER_PSEUDO = /:hover(?![\w-])/iu;
const HOVER_QUERY = /\(\s*hover\s*:\s*hover\s*\)/iu;
const NEGATED_HOVER_QUERY = /\bnot\s+(?:all\s+and\s+)?\(\s*hover\s*:\s*hover\s*\)/iu;

/**
 * @param {import('postcss').Container | import('postcss').Document | undefined} start
 * @returns {boolean}
 */
function insideHoverMedia(start) {
  /** @type {import('postcss').Container | import('postcss').Document | undefined} */
  let node = start;
  while (node) {
    if (node.type === 'atrule' && /** @type {import('postcss').AtRule} */ (node).name.toLowerCase() === 'media') {
      const { params } = /** @type {import('postcss').AtRule} */ (node);
      if (HOVER_QUERY.test(params) && !NEGATED_HOVER_QUERY.test(params)) return true;
    }
    node = /** @type {import('postcss').Container | undefined} */ (node.parent);
  }
  return false;
}

/** @type {import('stylelint').Rule} */
const rule = (primary) => (root, result) => {
  if (!validateOptions(result, ruleName, { actual: primary, possible: [true] })) return;

  root.walkRules((cssRule) => {
    if (!HOVER_PSEUDO.test(cssRule.selector) || insideHoverMedia(cssRule.parent)) return;
    report({ ruleName, result, node: cssRule, message: messages.rejected(cssRule.selector), word: ':hover' });
  });
};

rule.ruleName = ruleName;
rule.messages = messages;
rule.meta = { url: 'https://github.com/sukhchdit/shipcube/blob/main/tools/stylelint-rules/hover-in-media.mjs', fixable: false };

export default createPlugin(ruleName, rule);
