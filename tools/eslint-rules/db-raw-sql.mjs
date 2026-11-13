/**
 * `platform/db-raw-sql` (ADR-0005 am. 10 items 1 and 4, F-04; TASK-016; PR #11 m5, R2-m1, R2-M1, PR11-SEC-05/12/13/15):
 * in application code (apps/*\/src, services included, since they hold a `TenantDb` too) and the planned
 * non-repository Prisma files, raw SQL is parameterised only and nothing leaves the tenant transaction. Reported:
 *  - access to `$executeRawUnsafe` / `$queryRawUnsafe` (string interpolation is an injection surface; the `TenantDb`
 *    type omits both and its run-time Proxy throws);
 *  - access to `$parent` (Prisma's extension back-reference: an unguarded client of the same transaction),
 *    `_originalClient` (the root client) and `requestTransaction` (a PrismaPromise re-run with a caller-chosen
 *    transaction; `null` runs it on the root pool, PR11-SEC-12). "Access" is a member read (`a.b`, `a['b']`,
 *    `` a[`b`] ``) or an object-pattern key (`const { $parent } = db`, PR11-SEC-15 g);
 *  - the Prisma SQL helpers, resolved through scope analysis from every import of the Prisma client, its runtime
 *    packages or the generated client (any local name: default, namespace, named, aliased; `require`/`import()`),
 *    and every binding derived from one (`const r = Prisma.raw`, `const { raw, sql } = Prisma`, `P = Prisma`):
 *      - `raw` and `Sql`: any use (read, call, `new`, destructuring, re-export). Both build SQL TEXT from a string,
 *        and a tagged `$queryRaw` splices an `Sql` value into the statement (R2-m1; the `TenantDb` guard also
 *        refuses an `Sql` value at run time, PR11-SEC-13, so this rule is the early, source-level control);
 *      - `sql` / `sqltag` used other than as a template tag (a call `sql([s])` turns `s` into SQL text);
 *      - `join(values, separator, prefix, suffix)` unless the 2nd-4th arguments are string literals (they are text);
 *      - `makeTypedQueryFactory` / `TypedSql` (a `TypedSql` from any string, an `$queryRawUnsafe` equivalent once
 *        the typedSql preview is on, PR11-SEC-15 f);
 *      - a computed member of the namespace (`Prisma[name]`, which would hide the helper), a re-export of the
 *        namespace or a helper (the importing module would no longer be traceable), and a helper `sql`/`join`
 *        passed on as a value;
 *    plus `new Sql(…)` / `new <x>.Sql(…)` and `Prisma.raw` whatever the binding (belt and braces);
 *    PR11-SEC-17 a: ANY other use of a tracked container (an argument, an object/array literal, `?:` / `??`, a spread,
 *    a return, an array or member assignment target) is reported too, since the rule can no longer follow it, and so
 *    is the `constructor` of a fragment (`` Prisma.sql`…`.constructor ``) and any `new (<x>.constructor)(…)`;
 *  - a NON-tagged `$queryRaw(…)` / `$executeRaw(…)` call (the `Sql`-object overload splices a pre-built fragment;
 *    only the tagged template binds every value), and (PR11-SEC-17 a) ANY read of either member that is not the tag
 *    of a tagged template (an alias `const q = db.$queryRaw`, `Reflect.apply(db.$queryRaw, …)`, a destructured key);
 *  - a computed member of a database handle (`db[k]`, `tx[name]`; by name, see `isDbHandle`), which hides the member;
 *  - `SET LOCAL` in source text (it cannot take a bind parameter, 42601; settings go through the transaction-local
 *    setter in withTenantTx).
 * Legal: tagged `` Prisma.sql`… ${v}` `` fragments, `Prisma.join(ids)`, `Prisma.join(ids, ', ')`, tagged
 * `` db.$queryRaw`…` ``. Scoped by eslint.config.mjs; tests are excluded there (they assert that the Proxy refuses
 * these shapes).
 */
import { stringTextVisitor } from './string-literals.mjs';

/** Members that interpolate SQL text. */
const UNSAFE_MEMBERS = new Set(['$executeRawUnsafe', '$queryRawUnsafe']);
/** Members that lead out of the tenant transaction, with their message. */
const ESCAPE_MEMBERS = new Map([
  ['$parent', 'parent'],
  ['_originalClient', 'originalClient'],
  ['requestTransaction', 'requestTransaction'],
]);
const TAGGED_ONLY = new Set(['$queryRaw', '$executeRaw']);
/** Names of database handles for the `db[k]` check (see `isDbHandle`). */
const DB_HANDLE_NAME = /^(?:db|tx|prisma|client)$|(?:Db|Tx|Client|Prisma)$/u;
const SET_LOCAL = /\bset\s+local\b/iu;
/** Module specifiers that export Prisma's SQL helpers: the client, its runtime packages and the generated client. */
const PRISMA_SOURCES = /^(?:@prisma\/client(?:\/.*)?|@prisma\/client-runtime-utils(?:\/.*)?|.*\/generated\/prisma(?:\/.*)?)$/u;

/**
 * @typedef {'container' | 'raw' | 'Sql' | 'tag' | 'join' | 'typed' | 'fragment'} Kind `container`: a module object or
 *   the `Prisma` namespace (its members are the helpers); `fragment`: a value built by `sql` / `join`; the others: one
 *   helper.
 * @typedef {import('eslint').Rule.Node} RuleNode
 */

/** @type {ReadonlyMap<string, Kind>} exported helper name -> kind */
const HELPERS = new Map([
  ['raw', 'raw'],
  ['Sql', 'Sql'],
  ['sql', 'tag'],
  ['sqltag', 'tag'],
  ['join', 'join'],
  ['makeTypedQueryFactory', 'typed'],
  ['TypedSql', 'typed'],
]);
/** Members of a container that are containers themselves (the namespace in a module object, a CommonJS default). */
const CONTAINERS = new Set(['Prisma', 'default']);
/** Expressions that pass their operand's value through. */
const WRAPPERS = new Set([
  'AwaitExpression',
  'ChainExpression',
  'TSAsExpression',
  'TSNonNullExpression',
  'TSSatisfiesExpression',
  'TSTypeAssertion',
]);

/**
 * @param {import('estree').Node} key
 * @param {boolean} computed
 * @returns {string | undefined} the static name of a member or property key (`a.b`, `a['b']`, `` a[`b`] ``)
 */
function staticKey(key, computed) {
  if (key.type === 'Identifier') return computed ? undefined : key.name;
  if (key.type === 'Literal') return typeof key.value === 'string' ? key.value : undefined;
  if (key.type === 'TemplateLiteral' && key.expressions.length === 0) return key.quasis[0]?.value.cooked ?? undefined;
  return undefined;
}

/**
 * @param {import('eslint').Scope.Scope | null} scope
 * @param {string} name
 * @returns {import('eslint').Scope.Variable | undefined}
 */
function findVariable(scope, name) {
  for (let current = scope; current; current = current.upper) {
    const variable = current.set.get(name);
    if (variable) return variable;
  }
  return undefined;
}

/**
 * @param {unknown} node
 * @returns {boolean} true for `import type` / `export type` declarations and `type` specifiers
 */
const isTypeOnly = (node) => {
  const kind = /** @type {{ importKind?: string; exportKind?: string }} */ (node);
  return kind.importKind === 'type' || kind.exportKind === 'type';
};

/**
 * @param {import('estree').Node} node
 * @returns {boolean}
 */
const isPrismaSource = (node) => node.type === 'Literal' && typeof node.value === 'string' && PRISMA_SOURCES.test(node.value);

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Forbid unsafe raw-SQL shapes, the escapes from the tenant transaction and SET LOCAL text in application database code.',
    },
    schema: [],
    messages: {
      unsafeMember:
        "'{{name}}' interpolates SQL: use the tagged $executeRaw/$queryRaw templates (bind parameters) (ADR-0005 am. 10 item 4).",
      parent:
        "'$parent' reaches an unguarded client of the transaction (and through it the root client): use the TenantDb you were given (ADR-0005 am. 10 item 1, PR11-SEC-01).",
      originalClient:
        "'_originalClient' is the root client (another pooled connection, no tenant context): use the TenantDb you were given (ADR-0005 am. 10 item 1, PR11-SEC-01).",
      requestTransaction:
        "'requestTransaction' re-runs the query with a caller-chosen transaction (null runs it on the root pool, outside the tenant transaction): await the operation as it is (ADR-0005 am. 10 item 1, PR11-SEC-12).",
      prismaRaw:
        'Prisma.raw interpolates SQL exactly like the *Unsafe members: use the tagged $executeRaw/$queryRaw templates (bind parameters) (ADR-0005 am. 10 item 4, PR11-SEC-05, PR11-SEC-13).',
      sqlClass:
        "Prisma's Sql class builds a fragment from arbitrary strings, which a tagged $queryRaw/$executeRaw splices into the statement: use a tagged Prisma.sql`…` fragment (ADR-0005 am. 10 item 4, PR11-SEC-13).",
      tagCall:
        "'{{name}}' called as a function turns its strings into SQL text: use it only as a template tag, {{name}}`… ${value}` (ADR-0005 am. 10 item 4, PR11-SEC-13).",
      joinText:
        "The separator, prefix and suffix of '{{name}}' are SQL text: pass string literals or omit them (ADR-0005 am. 10 item 4, PR11-SEC-13).",
      helperValue:
        "'{{name}}' from the Prisma client passed on as a value cannot be checked: use it in place (sql as a template tag, join as a call) (ADR-0005 am. 10 item 4, PR11-SEC-13).",
      typedSql:
        "'{{name}}' builds a TypedSql query from any string (an $queryRawUnsafe equivalent once typedSql is enabled): not used until the preview is adopted (ADR-0005 am. 10 item 4, PR11-SEC-15).",
      dynamicMember:
        'A computed member of the Prisma client namespace hides which SQL helper is used: name the member statically (ADR-0005 am. 10 item 4, PR11-SEC-13).',
      reexport:
        "Re-exporting '{{name}}' of the Prisma client hides its SQL helpers from this rule: import from the Prisma client where it is used (ADR-0005 am. 10 item 4, PR11-SEC-13).",
      nonTagged:
        "'{{name}}(…)' called without a tagged template splices a pre-built SQL fragment: write {{name}}`…` so every value is a bind parameter (ADR-0005 am. 10 item 4).",
      setLocal:
        'SET LOCAL cannot take a bind parameter (42601): settings are applied by withTenantTx with the transaction-local setter (ADR-0005 am. 10 item 4).',
      containerValue:
        "'{{name}}' (the Prisma client namespace or module) passed on as a value cannot be followed to its SQL helpers: read its members in place (ADR-0005 am. 10 item 4, PR11-SEC-17).",
      rawRead:
        "'{{name}}' read other than as a template tag (an alias, an argument such as Reflect.apply, a destructured key) escapes the tagged-only check: write {{name}}`…` in place (ADR-0005 am. 10 item 4, PR11-SEC-17).",
      dynamicDbMember:
        'A computed member of a database handle hides which member is used ($queryRawUnsafe, $parent, …): name the member statically (ADR-0005 am. 10 item 1, PR11-SEC-17).',
    },
  },
  create(context) {
    const { sourceCode } = context;
    /** One finding per node, whichever path reaches it first. */
    const reported = new Set();
    /** Variables bound (directly or derived) to the Prisma client or one of its helpers. */
    const tracked = new Set();
    /** Named imports of `Sql` (already reported at the import specifier). */
    const importedSql = new Set();

    /**
     * @param {import('estree').Node} node
     * @param {string} messageId
     * @param {Record<string, string>} [data]
     */
    const report = (node, messageId, data) => {
      if (reported.has(node)) return;
      reported.add(node);
      context.report({ node, messageId, data });
    };

    /**
     * A helper is obtained at `node` (an import specifier, a member property or a destructured key).
     * @param {import('estree').Node} node
     * @param {string} name exported name
     */
    const obtained = (node, name) => {
      const kind = HELPERS.get(name);
      if (kind === 'raw') report(node, 'prismaRaw');
      else if (kind === 'Sql') report(node, 'sqlClass');
      else if (kind === 'typed') report(node, 'typedSql', { name });
    };

    /**
     * @param {import('eslint').Scope.Variable | undefined} variable
     * @param {Kind} kind
     * @param {string} name
     */
    const track = (variable, kind, name) => {
      if (!variable || tracked.has(variable)) return;
      tracked.add(variable);
      for (const reference of variable.references) {
        if (reference.init || !reference.isRead()) continue;
        if (/** @type {{ isValueReference?: boolean }} */ (reference).isValueReference === false) continue;
        follow(/** @type {RuleNode} */ (reference.identifier), kind, name);
      }
    };

    /**
     * The value of `kind` is bound to `pattern` (a declarator id or an assignment target).
     * @param {import('estree').Node} pattern
     * @param {Kind} kind
     * @param {string} name
     */
    const bind = (pattern, kind, name) => {
      const target = pattern.type === 'AssignmentPattern' ? pattern.left : pattern;
      if (target.type === 'Identifier') {
        if (kind === 'container' || kind === 'tag' || kind === 'join')
          track(findVariable(sourceCode.getScope(target), target.name), kind, name);
        return;
      }
      if (target.type !== 'ObjectPattern') {
        // An array pattern or a member target (`o.p = Prisma`): the value leaves this rule's sight (PR11-SEC-17 a).
        if (kind === 'container') report(target, 'containerValue', { name });
        else if (kind === 'tag' || kind === 'join') report(target, 'helperValue', { name });
        return;
      }
      if (kind !== 'container') {
        if (kind === 'tag' || kind === 'join') report(target, 'helperValue', { name });
        return;
      }
      for (const property of target.properties) {
        if (property.type === 'RestElement') {
          bind(property.argument, kind, name);
          continue;
        }
        const key = staticKey(property.key, property.computed);
        if (key === undefined) report(property.key, 'dynamicMember');
        else if (CONTAINERS.has(key)) bind(property.value, 'container', key);
        else {
          const helper = HELPERS.get(key);
          if (helper === undefined) continue;
          obtained(property.key, key);
          bind(property.value, helper, key);
        }
      }
    };

    /**
     * A member of a tracked value is read.
     * @param {import('estree').MemberExpression & RuleNode} member
     * @param {Kind} kind
     * @param {string} name
     */
    const readMember = (member, kind, name) => {
      if (kind !== 'container') {
        // `Prisma.sql.call(…)`, `join.apply(…)`: the helper itself escapes the checked forms.
        if (kind === 'tag' || kind === 'join') report(member.object, 'helperValue', { name });
        return;
      }
      const key = staticKey(member.property, member.computed);
      if (key === undefined) {
        report(member.property, 'dynamicMember');
        return;
      }
      if (CONTAINERS.has(key)) {
        follow(member, 'container', key);
        return;
      }
      const helper = HELPERS.get(key);
      if (helper === undefined) return;
      obtained(member.property, key);
      if (helper === 'tag' || helper === 'join') follow(member, helper, key);
    };

    /**
     * @param {import('estree').CallExpression} call
     * @param {string} name
     */
    const checkJoin = (call, name) => {
      call.arguments.forEach((argument, index) => {
        const text = argument.type === 'Literal' && typeof argument.value === 'string';
        if (argument.type === 'SpreadElement' || (index > 0 && !text)) report(argument, 'joinText', { name });
      });
    };

    /**
     * Follows one use of a tracked value: `expression` evaluates to it.
     * @param {RuleNode} expression
     * @param {Kind} kind
     * @param {string} name
     */
    function follow(expression, kind, name) {
      /** @type {RuleNode} */
      let node = expression;
      while (node.parent && WRAPPERS.has(node.parent.type)) node = node.parent;
      // The plain ESTree union, so that `switch (parent.type)` narrows it.
      const parent = /** @type {import('estree').Node | null} */ (node.parent);
      if (!parent) return;
      if (kind === 'fragment') {
        followFragment(node, parent);
        return;
      }
      switch (parent.type) {
        case 'MemberExpression':
          if (parent.object === node) {
            readMember(/** @type {import('estree').MemberExpression & RuleNode} */ (parent), kind, name);
            return;
          }
          break;
        case 'VariableDeclarator':
          if (parent.init === node) {
            bind(parent.id, kind, name);
            return;
          }
          break;
        case 'AssignmentExpression':
          if (parent.right === node && parent.operator === '=') {
            bind(parent.left, kind, name);
            return;
          }
          break;
        case 'ExportSpecifier':
        case 'ExportDefaultDeclaration':
          report(parent, 'reexport', { name });
          return;
        case 'TaggedTemplateExpression':
          if (parent.tag === node && kind === 'tag') {
            follow(/** @type {RuleNode} */ (parent), 'fragment', name);
            return;
          }
          break;
        case 'CallExpression':
          if (parent.callee === node) {
            if (kind === 'join') {
              checkJoin(parent, name);
              follow(/** @type {RuleNode} */ (parent), 'fragment', name);
            } else if (kind === 'tag') report(node, 'tagCall', { name });
            return;
          }
          break;
        default:
          break;
      }
      // PR11-SEC-17 a: any other use (an argument, an object/array literal, `?:` / `??` / `||`, a spread, a return, a
      // computed key, a compound assignment) passes the value on where this rule can no longer follow it.
      if (kind === 'tag' || kind === 'join') report(node, 'helperValue', { name });
      else if (kind === 'container') report(node, 'containerValue', { name });
    }

    /**
     * A Sql fragment (a tagged `Prisma.sql` template, a `Prisma.join` call, or a variable bound to one) is used. Its
     * `constructor` is Prisma's `Sql` class (`new (Prisma.sql`x`.constructor)([s], [])` forges a fragment from any
     * string), so reading it (statically, computed or by destructuring) is reported; every other use is legal.
     * @param {RuleNode} node
     * @param {import('estree').Node} parent
     */
    function followFragment(node, parent) {
      if (parent.type === 'MemberExpression' && parent.object === node) {
        const key = staticKey(parent.property, parent.computed);
        if (key === undefined || key === 'constructor' || key === '__proto__') report(parent.property, 'sqlClass');
        return;
      }
      const target = parent.type === 'VariableDeclarator' && parent.init === node ? parent.id : undefined;
      if (target?.type === 'Identifier') track(findVariable(sourceCode.getScope(target), target.name), 'fragment', 'fragment');
      else if (target?.type === 'ObjectPattern') {
        for (const property of target.properties) {
          const key = property.type === 'Property' ? staticKey(property.key, property.computed) : undefined;
          if (key === undefined || key === 'constructor' || key === '__proto__') report(property, 'sqlClass');
        }
      }
    }

    /** @param {import('estree').ImportDeclaration} declaration */
    const importDeclaration = (declaration) => {
      if (!isPrismaSource(declaration.source) || isTypeOnly(declaration)) return;
      for (const specifier of declaration.specifiers) {
        if (isTypeOnly(specifier)) continue;
        const [variable] = sourceCode.getDeclaredVariables(specifier);
        if (specifier.type !== 'ImportSpecifier') {
          track(variable, 'container', specifier.local.name);
          continue;
        }
        const { imported } = specifier;
        const name = imported.type === 'Identifier' ? imported.name : String(imported.value);
        const helper = HELPERS.get(name);
        if (CONTAINERS.has(name)) track(variable, 'container', name);
        else if (helper !== undefined) {
          obtained(specifier, name);
          if (helper === 'Sql') importedSql.add(variable);
          if (helper === 'tag' || helper === 'join') track(variable, helper, name);
        }
      }
    };

    /** @param {import('estree').ExportNamedDeclaration | import('estree').ExportAllDeclaration} declaration */
    const reexportDeclaration = (declaration) => {
      if (!declaration.source || !isPrismaSource(declaration.source) || isTypeOnly(declaration)) return;
      if (declaration.type === 'ExportAllDeclaration') {
        report(declaration, 'reexport', { name: '*' });
        return;
      }
      for (const specifier of declaration.specifiers) {
        const name = specifier.local.type === 'Identifier' ? specifier.local.name : String(specifier.local.value);
        if (!isTypeOnly(specifier) && (HELPERS.has(name) || CONTAINERS.has(name))) report(specifier, 'reexport', { name });
      }
    };

    /**
     * Checks an accessed member or destructured key against the unsafe and escape lists.
     * @param {import('estree').Node} keyNode
     * @param {string | undefined} key
     */
    const checkMember = (keyNode, key) => {
      if (key === undefined) return;
      if (UNSAFE_MEMBERS.has(key)) report(keyNode, 'unsafeMember', { name: key });
      const escape = ESCAPE_MEMBERS.get(key);
      if (escape !== undefined) report(keyNode, escape);
    };

    /**
     * True when the member expression is the tag of a tagged template (through TypeScript wrappers).
     * @param {RuleNode} member
     */
    const isTemplateTag = (member) => {
      /** @type {RuleNode} */
      let node = member;
      while (node.parent && WRAPPERS.has(node.parent.type)) node = node.parent;
      return node.parent?.type === 'TaggedTemplateExpression' && node.parent.tag === node;
    };

    /**
     * Heuristic for `db[k]` (PR11-SEC-17 a): the object is named like a database handle (`db`, `tx`, `prisma`,
     * `client`, or ending in `Db` / `Tx` / `Client` / `Prisma`, as an identifier or a static member). A computed key
     * of any other object (`rows[i]`) is not a database member.
     * @param {import('estree').Node} object
     */
    const isDbHandle = (object) => {
      const name =
        object.type === 'Identifier'
          ? object.name
          : object.type === 'MemberExpression'
            ? staticKey(object.property, object.computed)
            : undefined;
      return name !== undefined && DB_HANDLE_NAME.test(name);
    };

    const strings = stringTextVisitor((node, text) => {
      if (SET_LOCAL.test(text)) context.report({ node, messageId: 'setLocal' });
    });
    return {
      ...strings,
      Program(program) {
        // Imports first, so a later finding on the same node (the belt-and-braces checks) is not reported twice.
        for (const statement of program.body) {
          if (statement.type === 'ImportDeclaration') importDeclaration(statement);
          else if (statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportAllDeclaration') reexportDeclaration(statement);
        }
      },
      ImportExpression(node) {
        if (isPrismaSource(node.source)) follow(/** @type {RuleNode} */ (node), 'container', '*');
      },
      MemberExpression(node) {
        const key = staticKey(node.property, node.computed);
        checkMember(node.property, key);
        if (key !== undefined && TAGGED_ONLY.has(key) && !isTemplateTag(node)) report(node.property, 'rawRead', { name: key });
        // A numeric (or other non-string) literal index cannot name a member such as $queryRawUnsafe (`db[1]` of a
        // regular-expression match is not a database handle member).
        if (key === undefined && node.property.type !== 'Literal' && isDbHandle(node.object)) report(node.property, 'dynamicDbMember');
        // Belt and braces: `Prisma.raw` / `Prisma.Sql` on a `Prisma` this rule did not see imported.
        if (node.object.type === 'Identifier' && node.object.name === 'Prisma' && key !== undefined) {
          const variable = findVariable(sourceCode.getScope(node), 'Prisma');
          const helper = HELPERS.get(key);
          if (!tracked.has(variable) && (helper === 'raw' || helper === 'Sql')) obtained(node.property, key);
        }
      },
      ObjectPattern(node) {
        for (const property of node.properties) {
          if (property.type !== 'Property') continue;
          const key = staticKey(property.key, property.computed);
          checkMember(property.key, key);
          if (key !== undefined && TAGGED_ONLY.has(key)) report(property.key, 'rawRead', { name: key });
        }
      },
      NewExpression(node) {
        // Belt and braces: `new Sql(…)` / `new x.Sql(…)` whatever `Sql` is bound to, and `new (x.constructor)(…)`
        // (the constructor of a fragment or helper is a class or Function: PR11-SEC-17 a).
        const { callee } = node;
        const calleeKey = callee.type === 'MemberExpression' ? staticKey(callee.property, callee.computed) : undefined;
        if (callee.type === 'MemberExpression' && (calleeKey === 'Sql' || calleeKey === 'constructor')) report(callee.property, 'sqlClass');
        if (callee.type === 'Identifier' && callee.name === 'Sql' && !importedSql.has(findVariable(sourceCode.getScope(node), 'Sql'))) {
          report(callee, 'sqlClass');
        }
      },
      CallExpression(node) {
        const { callee } = node;
        const [first] = node.arguments;
        if (callee.type === 'Identifier' && callee.name === 'require' && first !== undefined && isPrismaSource(first)) {
          follow(/** @type {RuleNode} */ (node), 'container', '*');
        }
        if (callee.type !== 'MemberExpression') return;
        const name = staticKey(callee.property, callee.computed);
        if (name !== undefined && TAGGED_ONLY.has(name)) report(callee.property, 'nonTagged', { name });
      },
    };
  },
};
