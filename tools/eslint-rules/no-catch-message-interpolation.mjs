/**
 * `platform/no-catch-message-interpolation` (PR20-SEC-13 item 4, PR #20 L-13; NFR-SEC log hygiene): inside a
 * `catch (e)` clause, the caught error's text is not built into a string. A driver, SDK or validation message can carry
 * PII, SQL, request values or secrets, and a string defeats the logger's redaction and serializers.
 *
 * Reported when one of these is an expression of a template literal or an operand of `+` / `+=` (through `??`, `||`,
 * `&&`, `?:` branches and TypeScript `as` / `!` / `satisfies` wrappers):
 *  - `e.message` (also `e['message']`, `e?.message`);
 *  - the binding itself (`${e}`), `String(e)` and `e.toString()`;
 *  - a `message` destructured from the binding (`catch ({ message })`, `const { message } = e`).
 * Passing the error as a structured field (`log.error({ err: e }, 'msg')`) or rethrowing it is fine. Aliases
 * (`const m = e.message`) and helpers called with the message are not followed.
 */

/** Wrappers through which a value still reaches the string unchanged. */
const TRANSPARENT = new Set(['LogicalExpression', 'TSAsExpression', 'TSNonNullExpression', 'TSSatisfiesExpression', 'ChainExpression']);

/**
 * @typedef {import('estree').Node & { parent?: Node }} Node
 */

/**
 * @param {Node} node
 * @returns {string | undefined}
 */
function propertyName(node) {
  if (node.type !== 'MemberExpression') return undefined;
  if (!node.computed && node.property.type === 'Identifier') return node.property.name;
  if (node.computed && node.property.type === 'Literal' && typeof node.property.value === 'string') return node.property.value;
  return undefined;
}

/** TypeScript wrappers around the binding itself (`(e as Error).message`). */
const TYPE_WRAPPERS = new Set(['TSAsExpression', 'TSNonNullExpression', 'TSSatisfiesExpression', 'TSTypeAssertion']);

/**
 * @param {Node} node
 * @param {Node} argument
 * @returns {boolean} True for `String(argument)`.
 */
function isStringCall(node, argument) {
  return (
    node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'String' && node.arguments[0] === argument
  );
}

/**
 * @param {Node} node The usage (the value that would be stringified).
 * @returns {string | undefined} `template literal` or `string concatenation` when the usage is built into a string.
 */
function stringContext(node) {
  /** @type {Node} */
  let current = node;
  let parent = current.parent;
  // The Program node's parent is null.
  while (
    parent &&
    (TRANSPARENT.has(parent.type) || (parent.type === 'ConditionalExpression' && parent.test !== current) || isStringCall(parent, current))
  ) {
    current = parent;
    parent = current.parent;
  }
  if (!parent) return undefined;
  if (parent.type === 'TemplateLiteral') return 'template literal';
  if (parent.type === 'BinaryExpression' && parent.operator === '+') return 'string concatenation';
  if (parent.type === 'AssignmentExpression' && parent.operator === '+=' && parent.right === current) return 'string concatenation';
  return undefined;
}

/**
 * The `message` bindings of an object pattern (`{ message }`, `{ message: m }`).
 *
 * @param {import('estree').Pattern} pattern
 * @returns {import('estree').Identifier[]}
 */
function messageBindings(pattern) {
  if (pattern.type !== 'ObjectPattern') return [];
  return pattern.properties.flatMap((property) => {
    if (property.type !== 'Property') return [];
    const key = !property.computed && property.key.type === 'Identifier' ? property.key.name : undefined;
    let value = property.value;
    if (value.type === 'AssignmentPattern') value = value.left;
    return key === 'message' && value.type === 'Identifier' ? [value] : [];
  });
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: "Disallow building a caught error's message into a string (template literal or concatenation)." },
    schema: [],
    messages: {
      interpolated:
        "'{{text}}' puts the caught error's text into a {{context}}: error messages can carry PII, SQL, request values or secrets. Pass the error as a structured field ({ err }) to the logger, or map it to a catalogue code (PR20-SEC-13).",
    },
  },
  create(context) {
    const { sourceCode } = context;

    /**
     * @param {Node} usage
     */
    function reportIfStringified(usage) {
      const where = stringContext(usage);
      if (where !== undefined)
        context.report({ node: usage, messageId: 'interpolated', data: { text: sourceCode.getText(usage), context: where } });
    }

    /**
     * @param {import('estree').Identifier} binding
     */
    function checkMessageBinding(binding) {
      /** @type {import('eslint').Scope.Scope | null} */
      let scope = sourceCode.getScope(binding);
      while (scope) {
        const variable = scope.set.get(binding.name);
        if (variable?.identifiers.includes(binding)) {
          for (const reference of variable.references) {
            if (reference.isRead()) reportIfStringified(/** @type {Node} */ (reference.identifier));
          }
          return;
        }
        scope = scope.upper;
      }
    }

    /**
     * Uses of the catch binding (or of a variable destructured from it).
     *
     * @param {import('eslint').Scope.Variable} variable
     */
    function checkErrorVariable(variable) {
      for (const reference of variable.references) {
        if (!reference.isRead()) continue;
        /** @type {Node} */
        let value = /** @type {Node} */ (reference.identifier);
        while (value.parent && TYPE_WRAPPERS.has(value.parent.type)) value = value.parent;
        const parent = value.parent;
        if (!parent) continue;
        if (parent.type === 'MemberExpression' && parent.object === value) {
          const name = propertyName(parent);
          const grand = /** @type {Node} */ (parent).parent;
          if (name === 'message') reportIfStringified(parent);
          else if (name === 'toString' && grand?.type === 'CallExpression' && grand.callee === parent) reportIfStringified(grand);
        } else if (parent.type === 'VariableDeclarator' && parent.init === value) {
          for (const binding of messageBindings(parent.id)) checkMessageBinding(binding);
        } else {
          // `${e}`, `'x' + e` and `String(e)` (stringContext looks through String()).
          reportIfStringified(value);
        }
      }
    }

    return {
      CatchClause(node) {
        const { param } = node;
        if (param === null || param === undefined) return;
        if (param.type === 'Identifier') {
          for (const variable of sourceCode.getDeclaredVariables(node)) checkErrorVariable(variable);
          return;
        }
        for (const binding of messageBindings(param)) checkMessageBinding(binding);
      },
    };
  },
};
