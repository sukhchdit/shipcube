/**
 * `platform/money-arith` (NFR-DATA-001, ADR-0009 §3): no number arithmetic on money minor-unit values outside the
 * Money helpers of `@platform/shared` (`add`, `sub`, `mulRatio`, `allocate`, `convert`). The eslint.config.mjs turns
 * the rule off for `packages/shared/src/money/**`.
 *
 * Two branches (PR #2 code review m10, TASK-076):
 *  - type-aware, when the file has type information: an operand whose type carries the `Minor` brand of
 *    `@platform/shared` (`number & { readonly __brand: 'Minor' }`; through unions and intersections) is reported,
 *    whatever its name;
 *  - name-based, always (the fallback for untyped files): it recognises `amount`, `minor`, `<x>Amount`, `<x>Minor` and
 *    the snake-case column names `<x>_amount`, `<x>_minor`, as identifiers or as member names.
 * Both sides of a binary operator and of a compound assignment (`total += line.amount`) are checked. Comparisons are
 * allowed; so is `+` / `+=` on strings.
 *
 * Limits: an explicit conversion strips the brand and the name (`Number(m.amount) + 1`, `+m.amount * 1`), so it is not
 * reported; `-m.amount` is `@typescript-eslint/no-unsafe-unary-minus`.
 */
import ts from 'typescript';

const MINOR_BRAND_PROPERTY = '__brand';
const MINOR_BRAND_VALUE = 'Minor';

/**
 * True for `any` (TypeScript `TypeFlags.Any`, read from the installed compiler, not hard-coded).
 * @param {import('typescript').Type} type
 * @returns {boolean}
 */
function isAny(type) {
  return (type.flags & ts.TypeFlags.Any) !== 0;
}

/**
 * True when the TypeScript type, or one of its union/intersection constituents, has `__brand: 'Minor'`.
 * @param {import('typescript').Type} type
 * @param {import('typescript').TypeChecker} checker
 * @param {import('typescript').Node} location
 * @returns {boolean}
 */
function carriesMinorBrand(type, checker, location) {
  if (type.isUnionOrIntersection() && type.types.some((part) => carriesMinorBrand(part, checker, location))) return true;
  const brand = type.getProperty(MINOR_BRAND_PROPERTY);
  if (brand === undefined) return false;
  const brandType = checker.getTypeOfSymbolAtLocation(brand, location);
  return brandType.isStringLiteral() && brandType.value === MINOR_BRAND_VALUE;
}

const DEFAULT_NAME_PATTERN = '^(?:amount|minor|\\w+Amount|\\w+Minor|\\w+_amount|\\w+_minor)$';
const ARITHMETIC = new Set(['+', '-', '*', '/', '%', '**']);
const ARITHMETIC_ASSIGN = new Set(['+=', '-=', '*=', '/=', '%=', '**=']);

/**
 * Strips TypeScript wrappers that do not change the runtime value.
 * @param {import('estree').Node} node
 * @returns {import('estree').Node}
 */
function unwrap(node) {
  let current = /** @type {{ type: string; expression?: import('estree').Node }} */ (node);
  while (
    (current.type === 'TSNonNullExpression' || current.type === 'TSAsExpression' || current.type === 'TSSatisfiesExpression') &&
    current.expression
  ) {
    current = /** @type {typeof current} */ (current.expression);
  }
  return /** @type {import('estree').Node} */ (/** @type {unknown} */ (current));
}

/**
 * @param {import('estree').Node} node
 * @returns {boolean}
 */
function isStringish(node) {
  const inner = unwrap(node);
  return (inner.type === 'Literal' && typeof inner.value === 'string') || inner.type === 'TemplateLiteral';
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow number arithmetic on money minor-unit values outside the Money helpers (NFR-DATA-001).',
    },
    schema: [
      {
        type: 'object',
        properties: { namePattern: { type: 'string' } },
        additionalProperties: false,
      },
    ],
    messages: {
      moneyArithmetic:
        "Arithmetic on the money minor-unit value '{{name}}' is forbidden; use the Money helpers of @platform/shared (add, sub, mulRatio, allocate, convert).",
    },
  },
  create(context) {
    const options = /** @type {{ namePattern?: string } | undefined} */ (context.options[0]);
    const namePattern = new RegExp(options?.namePattern ?? DEFAULT_NAME_PATTERN, 'u');

    /**
     * @param {import('estree').Node} node
     * @returns {string | null} The matching name, or null when the node is not a money value.
     */
    function moneyName(node) {
      const inner = unwrap(node);
      /** @type {string | null} */
      let name = null;
      if (inner.type === 'Identifier') name = inner.name;
      else if (inner.type === 'MemberExpression') {
        const { property, computed } = inner;
        if (!computed && property.type === 'Identifier') name = property.name;
        else if (computed && property.type === 'Literal' && typeof property.value === 'string') name = property.value;
      }
      if (name !== null && namePattern.test(name)) return name;
      return brandedName(inner);
    }

    // Type information exists only for TypeScript files linted through the project service (or a `project`).
    const services = context.sourceCode.parserServices;
    const program = services?.program ?? null;
    const checker = program === null ? null : program.getTypeChecker();

    /**
     * The operand's source text when its type carries the `Minor` brand, else null (always null without types).
     * @param {import('estree').Node} node
     * @returns {string | null}
     */
    function brandedName(node) {
      if (checker === null || services?.esTreeNodeToTSNodeMap === undefined) return null;
      const tsNode = services.esTreeNodeToTSNodeMap.get(/** @type {never} */ (node));
      if (tsNode === undefined) return null;
      const type = checker.getTypeAtLocation(tsNode);
      return carriesMinorBrand(type, checker, tsNode) ? context.sourceCode.getText(node).slice(0, 40) : null;
    }

    /**
     * True when type information shows the expression is a string: assignable to `string` through the checker (code
     * review R2-M1: never through hard-coded `TypeFlags` values, whose bits differ between TypeScript versions), and not
     * `any` (which is assignable to everything). Untyped files answer false.
     * @param {import('estree').Node} node
     * @returns {boolean}
     */
    function isStringTyped(node) {
      if (checker === null || services?.esTreeNodeToTSNodeMap === undefined) return false;
      const tsNode = services.esTreeNodeToTSNodeMap.get(/** @type {never} */ (node));
      if (tsNode === undefined) return false;
      const type = checker.getTypeAtLocation(tsNode);
      return !isAny(type) && checker.isTypeAssignableTo(type, checker.getStringType());
    }

    return {
      BinaryExpression(node) {
        if (!ARITHMETIC.has(node.operator)) return;
        if (node.operator === '+' && (isStringish(node.left) || isStringish(node.right))) return;
        const name = moneyName(node.left) ?? moneyName(node.right);
        if (name !== null) context.report({ node, messageId: 'moneyArithmetic', data: { name } });
      },
      AssignmentExpression(node) {
        if (!ARITHMETIC_ASSIGN.has(node.operator)) return;
        // `text += …` builds a string (code review R1-m2 keeps it allowed); `total += line.amount` accumulates money.
        // Exempt only a string left side that is not itself Minor-branded (R2-M1).
        if (node.operator === '+=' && (isStringish(node.right) || (isStringTyped(node.left) && brandedName(unwrap(node.left)) === null)))
          return;
        const name = moneyName(node.left) ?? moneyName(node.right);
        if (name !== null) context.report({ node, messageId: 'moneyArithmetic', data: { name } });
      },
      UpdateExpression(node) {
        const name = moneyName(node.argument);
        if (name !== null) context.report({ node, messageId: 'moneyArithmetic', data: { name } });
      },
    };
  },
};
