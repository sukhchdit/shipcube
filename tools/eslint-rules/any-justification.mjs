/**
 * `platform/any-justification` (NFR-MAINT-002, US-001 "Unjustified any suppression is rejected"): an
 * `eslint-disable` directive that suppresses `@typescript-eslint/no-explicit-any` (named, or a blanket disable with no
 * rule list) must carry an ESLint directive description, `// eslint-disable-next-line <rule> -- <reason>`. The reason
 * should link the task that removes the suppression (CLAUDE.md §9 / NFR-MAINT-002).
 */

const ANY_RULE = '@typescript-eslint/no-explicit-any';
const DIRECTIVE = /^\s*(eslint-disable(?:-next-line|-line)?)(?:\s+([^]*))?$/u;

/**
 * Splits `rule-a, rule-b -- reason` on the first ` -- ` (ESLint requires whitespace around the separator).
 * @param {string} rest
 * @returns {{ rules: string[]; description: string }}
 */
function splitDirective(rest) {
  const separator = /(?:^|\s)--(?:\s|$)/u.exec(rest);
  const rulesPart = separator ? rest.slice(0, separator.index) : rest;
  const description = separator ? rest.slice(separator.index + separator[0].length).trim() : '';
  return {
    rules: rulesPart
      .split(',')
      .map((rule) => rule.trim())
      .filter((rule) => rule !== ''),
    description,
  };
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Require a "-- reason" description on eslint-disable directives that suppress no-explicit-any.' },
    schema: [],
    messages: {
      unjustified: "Suppressing '{{rule}}' needs a justification: '{{directive}} {{rule}} -- <reason, linked TASK-xxx>'.",
    },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const match = DIRECTIVE.exec(comment.value);
          const [, directive, rest = ''] = match ?? [];
          if (!directive) continue;
          const { rules, description } = splitDirective(rest);
          const suppressesAny = rules.length === 0 || rules.includes(ANY_RULE);
          if (suppressesAny && description === '' && comment.loc) {
            context.report({ loc: comment.loc, messageId: 'unjustified', data: { rule: ANY_RULE, directive } });
          }
        }
      },
    };
  },
};
