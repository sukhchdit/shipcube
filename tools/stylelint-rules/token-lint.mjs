/**
 * Stylelint rule `platform/token-lint` (US-101, REQ-UI-001; tokens.md §1 rule 1 and §5): feature stylesheets use design
 * tokens, never raw values. Reports a hard-coded colour (`#hex`, `rgb()`, `hsl()`, a named colour), off-grid spacing
 * (`margin: 13px`) and an unknown token (`var(--colour-nonexistent)`), naming file and line (Stylelint does both).
 * The analysis lives in tools/ui/token-lint.mjs and the token vocabulary in tools/ui/tokens-core.mjs, so the rule and
 * the generated theme cannot disagree. The generated theme is the one stylesheet allowed to hold raw values: the rule
 * is switched off for it in stylelint.config.mjs.
 */
import stylelint from 'stylelint';

import { findColourLiterals, findOffGridSpacing, findUnknownVariables, isRuntimeVariable } from '../ui/token-lint.mjs';
import { knownCssVariables, loadTokens, spaceScalePx } from '../ui/tokens-core.mjs';

const {
  createPlugin,
  utils: { report, ruleMessages, validateOptions },
} = stylelint;

export const ruleName = 'platform/token-lint';

export const messages = ruleMessages(ruleName, {
  colour: (literal, prop) =>
    `Unexpected hard-coded colour "${literal}" in "${prop}": use a colour token, for example var(--color-text-primary)`,
  spacing: (literal, prop, scale) =>
    `Unexpected off-grid spacing "${literal}" in "${prop}": use a spacing token such as var(--space-2) (the 4/8 px scale is ${scale})`,
  unknown: (name) => `Unknown design token "var(${name})": it is not defined by packages/ui/tokens/tokens.json or in this stylesheet`,
});

const tokens = loadTokens();
const KNOWN = knownCssVariables(tokens);
const SCALE = spaceScalePx(tokens);
const SCALE_TEXT = SCALE.join(', ');

/** @type {import('stylelint').Rule} */
const rule = (primary) => (root, result) => {
  if (!validateOptions(result, ruleName, { actual: primary, possible: [true] })) return;

  // Custom properties the stylesheet declares itself (component-local variables, @theme entries, @property).
  /** @type {Set<string>} */
  const local = new Set();
  root.walkDecls(/^--/u, (decl) => {
    local.add(decl.prop);
  });
  root.walkAtRules('property', (atRule) => {
    local.add(atRule.params.trim());
  });
  const isKnown = (/** @type {string} */ name) => KNOWN.has(name) || local.has(name) || isRuntimeVariable(name);

  root.walkDecls((decl) => {
    const { prop, value } = decl;
    const custom = prop.startsWith('--');
    // Named colours and spacing are judged by property; a custom property is only checked for literals that are always colours.
    for (const literal of findColourLiterals(custom ? '--' : prop, value)) {
      report({ ruleName, result, node: decl, message: messages.colour(literal, prop), word: literal });
    }
    for (const literal of custom ? [] : findOffGridSpacing(prop, value, SCALE)) {
      report({ ruleName, result, node: decl, message: messages.spacing(literal, prop, SCALE_TEXT), word: literal });
    }
    for (const name of findUnknownVariables(value, isKnown)) {
      report({ ruleName, result, node: decl, message: messages.unknown(name), word: name });
    }
  });
};

rule.ruleName = ruleName;
rule.messages = messages;
rule.meta = { url: 'https://github.com/sukhchdit/shipcube/blob/main/tools/stylelint-rules/token-lint.mjs', fixable: false };

export default createPlugin(ruleName, rule);
