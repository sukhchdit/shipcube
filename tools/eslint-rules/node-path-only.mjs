/**
 * `platform/node-path-only` (ADR-0002 §5): Node.js built-in modules are imported only through the explicit `node:`
 * scheme (`node:path`, `node:fs/promises`), never as bare `path` / `fs`. A bare specifier can be shadowed by a package
 * of the same name, and the prefix makes built-ins visible to boundary and dependency checks. Auto-fixable. Checked on
 * static imports, re-exports, `import()` and every require-style load, `createRequire` aliases included (R1-m6).
 */
import { builtinModules } from 'node:module';

import { moduleSourceVisitor } from './module-sources.mjs';

const BUILTINS = new Set(builtinModules.filter((name) => !name.startsWith('_') && !name.startsWith('node:')));

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    fixable: 'code',
    docs: { description: "Require the 'node:' prefix on Node.js built-in module specifiers." },
    schema: [],
    messages: {
      missingPrefix: "Import the Node.js built-in '{{source}}' as 'node:{{source}}'.",
    },
  },
  create(context) {
    return moduleSourceVisitor(({ node, source }) => {
      if (!BUILTINS.has(source)) return;
      context.report({
        node,
        messageId: 'missingPrefix',
        data: { source },
        fix: (fixer) => {
          const raw = context.sourceCode.getText(node);
          return fixer.replaceText(node, `${raw.charAt(0)}node:${source}${raw.charAt(0)}`);
        },
      });
    }, context.sourceCode);
  },
};
