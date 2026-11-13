/**
 * `platform/system-model-owner` (PR19-SEC-01, D-ARCH-080; data-model §1.5 SYSTEM row): SYSTEM-class model delegates
 * are absent from `TenantDb` and handed out only by `systemDelegates(tx)` (apps/api/src/platform/db/system-db.ts, the
 * worker twin apps/worker/src/platform/db/system-db.ts, or a future `@platform/api/runtime` re-export). This rule
 * decides, PER MODEL, who may use that accessor: only the module whose table-class manifest declares the table.
 *
 * Manifest-driven: the SYSTEM tables and their declaring module come from `tools/db/table-classes/*.json` (class
 * `SYSTEM`), the delegate name of each table from the Prisma schema (`prisma/schema/*.prisma`: a `model X` block whose
 * `@@map` names table `t` gives delegate `x`), both read relative to the ESLint `cwd` (so a lint fixture root carries its own miniature
 * manifests). The option `owners` maps a manifest module to the path globs of its code (eslint.config.mjs
 * `SYSTEM_MODEL_OWNERS`); a module without an entry owns `apps/*\/src/modules/<module>/**`.
 *
 * Reported:
 *  - `notOwner`: `systemDelegates(tx).<model>` (or `const { <model> } = systemDelegates(tx)`) in a file outside the
 *    owning module of the model's table;
 *  - `notSystem`: a delegate that is not a SYSTEM model (it is on `TenantDb`; use that);
 *  - `untracked`: any other use of the accessor, which would hide the model from this rule (aliasing the accessor or
 *    its result, passing it on, a computed or rest key, a namespace or dynamic import, `require`);
 *  - `reexport`: re-exporting the accessor or the port module;
 *  - `port`: importing `platform/db/system-port` (the private link between a handle and its SYSTEM guard; only
 *    tenant-db.ts and system-db.ts, which this rule does not lint, may import it);
 *  - `manifest`: the manifests or the schema cannot be read (fail closed, reported on the accessor import).
 * Scoped in eslint.config.mjs to application and package sources, outside apps/*\/src/platform/db and tests.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

/** Module specifiers of the accessor: the api file, the worker twin, the runtime entry (once it re-exports it). */
const ACCESSOR_SOURCE = /(?:^|\/)platform\/db\/system-db(?:\.[cm]?[jt]s)?$|^@platform\/api\/runtime$/u;
const PORT_SOURCE = /(?:^|\/)platform\/db\/system-port(?:\.[cm]?[jt]s)?$/u;
const ACCESSOR = 'systemDelegates';
const DEFAULT_MANIFEST_DIR = 'tools/db/table-classes';
const DEFAULT_SCHEMA_DIR = 'prisma/schema';
/** `model Name {` … `@@map("table")` … `}` (a model block never nests braces in Prisma schema syntax). */
const MODEL_BLOCK = /^model\s+([A-Za-z][A-Za-z0-9_]*)\s*\{([^}]*)\}/gmu;
const MAP_ATTRIBUTE = /@@map\(\s*(?:name:\s*)?"([^"]+)"\s*\)/u;
const WRAPPERS = new Set(['AwaitExpression', 'ChainExpression', 'TSAsExpression', 'TSNonNullExpression', 'TSSatisfiesExpression']);

/**
 * @typedef {{ table: string; module: string }} SystemModel
 * @typedef {import('eslint').Rule.Node} RuleNode
 */

/**
 * The models of one Prisma schema text and their table (`@@map`, else the model name).
 * @param {string} text
 * @returns {{ model: string; table: string }[]}
 */
export function parseSchemaModels(text) {
  return [...text.matchAll(MODEL_BLOCK)].map(([, model = '', body = '']) => ({ model, table: MAP_ATTRIBUTE.exec(body)?.[1] ?? model }));
}

/** @param {string} name */
const delegateName = (name) => name.charAt(0).toLowerCase() + name.slice(1);

/**
 * SYSTEM tables -> declaring module, from every `*.json` manifest of `dir`.
 * @param {string} dir
 * @returns {Map<string, string>}
 */
function systemTables(dir) {
  /** @type {Map<string, string>} */
  const tables = new Map();
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.json'))) {
    /** @type {unknown} */
    const manifest = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    const { module, tables: entries } = /** @type {{ module?: unknown; tables?: unknown }} */ (manifest ?? {});
    if (typeof module !== 'string' || !Array.isArray(entries)) throw new Error(`${file}: not a table-class manifest`);
    for (const entry of /** @type {unknown[]} */ (entries)) {
      const { name, class: tableClass } = /** @type {{ name?: unknown; class?: unknown }} */ (entry ?? {});
      if (typeof name === 'string' && tableClass === 'SYSTEM') tables.set(name, module);
    }
  }
  return tables;
}

/**
 * Delegate name -> SYSTEM table and declaring module, for every SYSTEM table that has a Prisma model.
 * @param {string} root the repository (or fixture) root
 * @param {{ manifestDir?: string | undefined; schemaDir?: string | undefined }} [dirs]
 * @returns {ReadonlyMap<string, SystemModel>}
 */
export function loadSystemModels(root, { manifestDir = DEFAULT_MANIFEST_DIR, schemaDir = DEFAULT_SCHEMA_DIR } = {}) {
  const tables = systemTables(resolve(root, manifestDir));
  const schemas = resolve(root, schemaDir);
  /** @type {Map<string, SystemModel>} */
  const models = new Map();
  for (const file of readdirSync(schemas).filter((name) => name.endsWith('.prisma'))) {
    for (const { model, table } of parseSchemaModels(readFileSync(join(schemas, file), 'utf8'))) {
      const module = tables.get(table);
      if (module !== undefined) models.set(delegateName(model), { table, module });
    }
  }
  return models;
}

/** @type {Map<string, ReadonlyMap<string, SystemModel> | Error>} cache per root and directories */
const CACHE = new Map();

/**
 * @param {string} root
 * @param {{ manifestDir?: string | undefined; schemaDir?: string | undefined }} dirs
 */
function cachedModels(root, dirs) {
  const key = `${root}\0${dirs.manifestDir ?? ''}\0${dirs.schemaDir ?? ''}`;
  let models = CACHE.get(key);
  if (models === undefined) {
    try {
      models = loadSystemModels(root, dirs);
    } catch (error) {
      models = error instanceof Error ? error : new Error(String(error));
    }
    CACHE.set(key, models);
  }
  return models;
}

/**
 * A path glob (`*` within a segment, `**` across segments) as an anchored regular expression.
 * @param {string} glob
 */
const globPattern = (glob) =>
  new RegExp(
    `^${glob
      .split('**')
      .map((part) =>
        part
          .split('*')
          .map((text) => text.replace(/[.+?^${}()|[\]\\]/gu, '\\$&'))
          .join('[^/]*'),
      )
      .join('.*')}$`,
    'u',
  );

/**
 * @param {import('estree').Node} key
 * @param {boolean} computed
 * @returns {string | undefined}
 */
function staticKey(key, computed) {
  if (key.type === 'Identifier') return computed ? undefined : key.name;
  if (key.type === 'Literal') return typeof key.value === 'string' ? key.value : undefined;
  return undefined;
}

/** @param {unknown} node */
const isTypeOnly = (node) => {
  const kind = /** @type {{ importKind?: string; exportKind?: string }} */ (node);
  return kind.importKind === 'type' || kind.exportKind === 'type';
};

/**
 * A module specifier as matched against the source patterns: a relative one resolved against the importing file's
 * directory (POSIX), so `../db/system-db.js` from `apps/api/src/platform/outbox/` is `…/platform/db/system-db.js`.
 * @param {string} specifier
 * @param {string} filename absolute path of the importing file
 */
const resolvedSpecifier = (specifier, filename) =>
  specifier.startsWith('.') ? resolve(dirname(filename), specifier).split(sep).join('/') : specifier;

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Restrict each SYSTEM-class model delegate to the module whose table-class manifest declares the table (D-ARCH-080).',
    },
    schema: [
      {
        type: 'object',
        properties: {
          owners: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
          manifestDir: { type: 'string' },
          schemaDir: { type: 'string' },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      notOwner:
        "'{{model}}' is the SYSTEM table {{table}}, declared by the '{{module}}' table-class manifest: only that module's code may use it through systemDelegates(tx) (data-model §1.5, PR19-SEC-01, D-ARCH-080).",
      notSystem:
        "'{{model}}' is not a SYSTEM model in the table-class manifests: use it on the TenantDb you were given, not through systemDelegates(tx) (D-ARCH-080).",
      untracked:
        'Use systemDelegates as `systemDelegates(tx).<model>` or `const { <model> } = systemDelegates(tx)`, imported by name: any other form hides which SYSTEM model is reached (PR19-SEC-01, D-ARCH-080).',
      reexport: 'Re-exporting the SYSTEM accessor or its port hides its importers from platform/system-model-owner (D-ARCH-080).',
      port: 'platform/db/system-port is private to platform/db (tenant-db.ts and system-db.ts): use systemDelegates(tx) (D-ARCH-080).',
      manifest:
        'platform/system-model-owner cannot read the table-class manifests or the Prisma schema ({{reason}}): fix them; the rule fails closed.',
    },
  },
  create(context) {
    const options = /** @type {{ owners?: Record<string, string[]>; manifestDir?: string; schemaDir?: string } | undefined} */ (
      context.options[0]
    );
    const owners = options?.owners ?? {};
    const root = context.cwd;
    const file = relative(root, context.filename).split(sep).join('/');
    const { sourceCode } = context;
    /** @type {ReadonlyMap<string, SystemModel> | undefined} */
    let models;

    /**
     * @param {import('estree').Node | null | undefined} node
     * @param {RegExp} pattern
     */
    const sourceMatches = (node, pattern) =>
      node?.type === 'Literal' && typeof node.value === 'string' && pattern.test(resolvedSpecifier(node.value, context.filename));

    /** @param {string} module */
    const ownedHere = (module) => (owners[module] ?? [`apps/*/src/modules/${module}/**`]).some((glob) => globPattern(glob).test(file));

    /**
     * @param {import('estree').Node} node
     * @param {string} model
     */
    const checkModel = (node, model) => {
      const entry = models?.get(model);
      if (entry === undefined) context.report({ node, messageId: 'notSystem', data: { model } });
      else if (!ownedHere(entry.module)) context.report({ node, messageId: 'notOwner', data: { model, ...entry } });
    };

    /**
     * One reference to the accessor: it must be the callee of a call whose result is read once, statically.
     * @param {RuleNode} identifier
     */
    const checkReference = (identifier) => {
      /** @type {RuleNode} */
      let node = identifier;
      while (node.parent && WRAPPERS.has(node.parent.type)) node = node.parent;
      const call = node.parent;
      if (call?.type !== 'CallExpression' || call.callee !== node) {
        context.report({ node: identifier, messageId: 'untracked' });
        return;
      }
      /** @type {RuleNode} */
      let result = call;
      while (result.parent && WRAPPERS.has(result.parent.type)) result = result.parent;
      const use = /** @type {import('estree').Node | null} */ (result.parent);
      if (use?.type === 'MemberExpression' && use.object === result) {
        const key = staticKey(use.property, use.computed);
        if (key === undefined) context.report({ node: use.property, messageId: 'untracked' });
        else checkModel(use.property, key);
        return;
      }
      if (use?.type === 'VariableDeclarator' && use.init === result && use.id.type === 'ObjectPattern') {
        for (const property of use.id.properties) {
          const key = property.type === 'Property' ? staticKey(property.key, property.computed) : undefined;
          if (property.type === 'Property' && key !== undefined) checkModel(property.key, key);
          else context.report({ node: property, messageId: 'untracked' });
        }
        return;
      }
      context.report({ node: call, messageId: 'untracked' });
    };

    /** @param {import('estree').ImportDeclaration} declaration */
    const importDeclaration = (declaration) => {
      if (sourceMatches(declaration.source, PORT_SOURCE)) {
        context.report({ node: declaration, messageId: 'port' });
        return;
      }
      if (!sourceMatches(declaration.source, ACCESSOR_SOURCE) || isTypeOnly(declaration)) return;
      for (const specifier of declaration.specifiers) {
        if (isTypeOnly(specifier)) continue;
        if (specifier.type !== 'ImportSpecifier') {
          context.report({ node: specifier, messageId: 'untracked' });
          continue;
        }
        const { imported } = specifier;
        if ((imported.type === 'Identifier' ? imported.name : String(imported.value)) !== ACCESSOR) continue;
        if (models === undefined) {
          const loaded = cachedModels(root, { manifestDir: options?.manifestDir, schemaDir: options?.schemaDir });
          if (loaded instanceof Error) {
            context.report({ node: specifier, messageId: 'manifest', data: { reason: loaded.message } });
            return;
          }
          models = loaded;
        }
        const [variable] = sourceCode.getDeclaredVariables(specifier);
        for (const reference of variable?.references ?? []) {
          if (/** @type {{ isValueReference?: boolean }} */ (reference).isValueReference === false) continue;
          checkReference(/** @type {RuleNode} */ (reference.identifier));
        }
      }
    };

    /** @param {import('estree').ExportNamedDeclaration | import('estree').ExportAllDeclaration} declaration */
    const reexport = (declaration) => {
      if (declaration.source && (sourceMatches(declaration.source, ACCESSOR_SOURCE) || sourceMatches(declaration.source, PORT_SOURCE))) {
        if (!isTypeOnly(declaration)) context.report({ node: declaration, messageId: 'reexport' });
      }
    };

    /** @param {import('estree').Node} node */
    const dynamicLoad = (node) => context.report({ node, messageId: 'untracked' });

    return {
      ImportDeclaration: importDeclaration,
      ExportNamedDeclaration: reexport,
      ExportAllDeclaration: reexport,
      ImportExpression(node) {
        if (sourceMatches(node.source, ACCESSOR_SOURCE) || sourceMatches(node.source, PORT_SOURCE)) dynamicLoad(node);
      },
      CallExpression(node) {
        const [first] = node.arguments;
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'require' || first === undefined) return;
        if (first.type !== 'SpreadElement' && (sourceMatches(first, ACCESSOR_SOURCE) || sourceMatches(first, PORT_SOURCE)))
          dynamicLoad(node);
      },
    };
  },
};
