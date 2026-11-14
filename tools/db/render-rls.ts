/**
 * RLS renderer (data-model.md §4.3, §8.1; ADR-0005 and am. 10 items 7 and 11; PR7-SEC-04, PR7-SEC-07; TASK-016).
 *
 * Renders the row-level security block of one table from its table-class manifest entry
 * (`tools/db/table-classes/<module>.json`) and the templates in `prisma/sql/policy-templates/*.sql`:
 *
 *   TENANT         enable-force + tenant + operator
 *   GUEST_CAPABLE  enable-force + tenant + operator + guest + guest-capable-guard-trigger
 *   USER_OWNED     enable-force + user-owned + operator
 *   flags          definerRead -> definer-read; definerPurge -> definer-purge
 *   policySet      (DR-A14, data-model §4.3 as amended 2026-11-13; D-ARCH-072) dr-a14-users replaces user-owned,
 *                  dr-a14-organisations replaces tenant, dr-a14-memberships follows tenant
 *
 * `renderStdColumnsGuard(entry)` renders `trg_<table>__std_columns` for a table flagged `stdColumns` (any class;
 * data-model §7.6 amendment of 2026-11-13, D-ARCH-091); `renderModule` appends it after the table's RLS block.
 *
 * The three DR-A14 templates may use, and only they, the exact extra atoms of DR_A14_ATOMS (`id = <helper>()` and one
 * `EXISTS` over `public.memberships` with a positive status list each); the forbidden-token scan runs over the whole
 * predicate, so every refused token stays refused inside the `EXISTS`.
 *
 * Policies are emitted ONLY from those templates, and every template is checked against the predicate allow-list
 * before it is used (ADR-0005 am. 10 item 7): a policy predicate is a conjunction of the atoms
 * `org_id = platform.app_org_id()`, `user_id = platform.app_actor_id()`,
 * `guest_token_hash = platform.app_guest_token_hash()`, `org_id IS NULL` and the operator pair
 * `current_setting('app.actor_scope', true) = 'OPERATOR' AND platform.app_is_operator()`, with at least one keyed atom;
 * the `TO platform_definer` policies are exactly `USING (true)` (SELECT) and the expiry predicate (DELETE). Equality
 * against a NULL-returning helper is what makes an unset or empty context fail closed (F-07), so `IS [NOT] DISTINCT
 * FROM`, `coalesce`, `<>`/`!=`, `NOT`, `OR` and a raw `current_setting(` outside the operator pair are refused.
 *
 * Output is deterministic (fixed block order, template comments stripped, one trailing newline) and every rendered
 * identifier is validated (lowercase SQL identifier, at most 63 bytes, so PostgreSQL never truncates a policy name).
 *
 * CLI: `tsx tools/db/render-rls.ts <module>` prints the blocks of every RLS table of that module manifest, ready to be
 * pasted into the module's migration after its CREATE TABLE statements.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { POLICY_SETS, RLS_CLASSES, loadTableClasses, type PolicySet, type TableClassEntry } from './table-classes.js';

export const POLICY_TEMPLATE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'prisma', 'sql', 'policy-templates');
export const FUNCTION_TEMPLATE_DIR = resolve(POLICY_TEMPLATE_DIR, '..', 'function-templates');

export const TEMPLATE_NAMES = [
  'enable-force',
  'tenant',
  'operator',
  'guest',
  'user-owned',
  'definer-read',
  'definer-purge',
  'guest-capable-guard-trigger',
  'dr-a14-users',
  'dr-a14-memberships',
  'dr-a14-organisations',
  'std-columns-guard-trigger',
] as const;
export type TemplateName = (typeof TEMPLATE_NAMES)[number];
export type TemplateSet = Readonly<Record<TemplateName, string>>;

export const GUARD_FUNCTION_TEMPLATE = 'guest-capable-guard-function';
export const STD_COLUMNS_GUARD_FUNCTION_TEMPLATE = 'std-columns-guard';

/** PostgreSQL NAMEDATALEN - 1. */
export const MAX_IDENTIFIER_LENGTH = 63;
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const PLACEHOLDER = /\{\{\s*([^}]*?)\s*\}\}/g;
const TABLE_PLACEHOLDER = 'table';

export class RenderRlsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RenderRlsError';
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Predicate allow-list
// ---------------------------------------------------------------------------------------------------------------------

/** Keyed atoms: each one binds the row to a context value through a NULL-returning helper. */
const KEYED_ATOMS: ReadonlySet<string> = new Set([
  'org_id = platform.app_org_id()',
  'user_id = platform.app_actor_id()',
  'guest_token_hash = platform.app_guest_token_hash()',
  'platform.app_is_operator()',
]);
const OPERATOR_SCOPE_ATOM = "current_setting('app.actor_scope', true) = 'OPERATOR'";
const OPERATOR_ATOM = 'platform.app_is_operator()';
/** Unkeyed atoms: allowed only next to a keyed atom. */
const UNKEYED_ATOMS: ReadonlySet<string> = new Set(['org_id IS NULL', OPERATOR_SCOPE_ATOM]);

/**
 * DR-A14 extra atoms, per template, in template form (`{{table}}` is the table of the same name). Each is keyed: it binds
 * the row to a context helper. Admitted ONLY in the template named (D-ARCH-072); everywhere else they are refused.
 */
export const DR_A14_ATOMS: Readonly<Record<PolicySet, ReadonlySet<string>>> = {
  'dr-a14-users': new Set([
    'id = platform.app_actor_id()',
    "EXISTS (SELECT 1 FROM public.memberships m WHERE m.user_id = {{table}}.id AND m.org_id = platform.app_org_id() AND m.status IN ('INVITED','ACTIVE','SUSPENDED'))",
  ]),
  'dr-a14-memberships': new Set(),
  'dr-a14-organisations': new Set([
    'id = platform.app_org_id()',
    "EXISTS (SELECT 1 FROM public.memberships m WHERE m.org_id = {{table}}.id AND m.user_id = platform.app_actor_id() AND m.status IN ('ACTIVE','SUSPENDED'))",
  ]),
};
const NO_EXTRA_ATOMS: ReadonlySet<string> = new Set();
const isPolicySetName = (name: string): name is PolicySet => Object.hasOwn(POLICY_SETS, name);

const DEFINER_PREDICATES: Readonly<Record<string, string>> = {
  SELECT: 'true',
  DELETE: "expires_at < now() - interval '7 days'",
};

/** Forbidden anywhere in a policy predicate (ADR-0005 am. 10 item 7; mirrored by catalog test C3). */
export const FORBIDDEN_PREDICATE_TOKENS: readonly (readonly [string, RegExp])[] = [
  ['IS [NOT] DISTINCT FROM', /\bIS\s+(?:NOT\s+)?DISTINCT\s+FROM\b/i],
  ['coalesce', /\bcoalesce\b/i],
  ['<>', /<>/],
  ['!=', /!=/],
  ['NOT', /\bNOT\b/i],
  ['OR', /\bOR\b/i],
];

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** Splits on top-level ` AND ` (outside parentheses and string literals). */
function splitConjuncts(predicate: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < predicate.length; i += 1) {
    const ch = predicate[i];
    if (ch === "'") quoted = !quoted;
    else if (!quoted && ch === '(') depth += 1;
    else if (!quoted && ch === ')') depth -= 1;
    else if (!quoted && depth === 0 && /^ AND /i.test(predicate.slice(i, i + 5))) {
      parts.push(predicate.slice(start, i));
      start = i + 5;
      i += 4;
    }
  }
  parts.push(predicate.slice(start));
  return parts.map((part) => part.trim());
}

/**
 * Returns the reason a policy predicate is refused, or `null` when it is on the allow-list. `extraAtoms` are the keyed
 * DR-A14 atoms of the one template being validated (empty everywhere else).
 */
export function checkPredicate(
  predicate: string,
  role: string,
  command: string,
  extraAtoms: ReadonlySet<string> = NO_EXTRA_ATOMS,
): string | null {
  const text = collapse(predicate);
  for (const [token, pattern] of FORBIDDEN_PREDICATE_TOKENS) {
    if (pattern.test(text)) return `forbidden token ${token}`;
  }
  if (role === 'platform_definer') {
    const expected = DEFINER_PREDICATES[command];
    return expected !== undefined && text === expected ? null : `predicate not allowed for platform_definer FOR ${command}`;
  }
  const conjuncts = splitConjuncts(text);
  const keyed = (conjunct: string): boolean => KEYED_ATOMS.has(conjunct) || extraAtoms.has(conjunct);
  for (const conjunct of conjuncts) {
    if (!keyed(conjunct) && !UNKEYED_ATOMS.has(conjunct)) {
      return /current_setting\s*\(/i.test(conjunct)
        ? 'raw current_setting( outside the helpers'
        : `predicate atom not on the allow-list: ${conjunct}`;
    }
  }
  if (!conjuncts.some(keyed)) return 'predicate has no keyed atom';
  const operatorPair = conjuncts.includes(OPERATOR_SCOPE_ATOM) || conjuncts.includes(OPERATOR_ATOM);
  if (operatorPair && !(conjuncts.includes(OPERATOR_SCOPE_ATOM) && conjuncts.includes(OPERATOR_ATOM))) {
    return 'the operator branch needs both the actor_scope check and platform.app_is_operator()';
  }
  if (operatorPair && command !== 'SELECT') return 'the operator branch is read-only (FOR SELECT)';
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Template validation
// ---------------------------------------------------------------------------------------------------------------------

/** Removes `--` comments (templates hold no string literal containing `--`) and blank lines. */
export function stripComments(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, '').trimEnd())
    .filter((line) => line.trim() !== '')
    .join('\n');
}

/** The contents of the balanced parenthesis group that opens at `open` (index of `(`), and the index after it. */
function balanced(text: string, open: number): { inner: string; end: number } {
  let depth = 0;
  let quoted = false;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "'") quoted = !quoted;
    else if (!quoted && ch === '(') depth += 1;
    else if (!quoted && ch === ')') {
      depth -= 1;
      if (depth === 0) return { inner: text.slice(open + 1, i), end: i + 1 };
    }
  }
  throw new RenderRlsError('unbalanced parentheses');
}

const T = '\\{\\{table\\}\\}';
const STATEMENT_SHAPES: readonly RegExp[] = [
  new RegExp(`^ALTER TABLE public\\.${T} (?:ENABLE|FORCE) ROW LEVEL SECURITY$`),
  new RegExp(`^GRANT (?:SELECT|DELETE) ON public\\.${T} TO platform_definer$`),
  new RegExp(
    `^CREATE TRIGGER tg_${T}__guest_capable_guard BEFORE UPDATE ON public\\.${T} FOR EACH ROW EXECUTE FUNCTION platform\\.guest_capable_guard\\(\\)$`,
  ),
  new RegExp(
    `^CREATE TRIGGER trg_${T}__std_columns BEFORE INSERT OR UPDATE ON public\\.${T} FOR EACH ROW EXECUTE FUNCTION platform\\.std_columns_guard\\(\\)$`,
  ),
];
const POLICY_HEAD = new RegExp(
  `^CREATE POLICY p_${T}__([a-z_]+) ON public\\.${T} FOR (ALL|SELECT|INSERT|UPDATE|DELETE) TO (platform_app|platform_definer)`,
);

function checkPolicy(statement: string, where: string, extraAtoms: ReadonlySet<string>): void {
  const head = POLICY_HEAD.exec(statement);
  if (head === null) throw new RenderRlsError(`${where}: policy header outside the template shape`);
  const [, , command = '', role = ''] = head;
  let rest = statement.slice(head[0].length);
  const clauses: Record<string, string> = {};
  for (const clause of ['USING', 'WITH CHECK'] as const) {
    const match = new RegExp(`^ ${clause} \\(`).exec(rest);
    if (match === null) continue;
    const { inner, end } = balanced(rest, match[0].length - 1);
    clauses[clause] = inner;
    rest = rest.slice(end);
  }
  if (rest.trim() !== '') throw new RenderRlsError(`${where}: unexpected text after the policy predicates`);
  if (clauses['USING'] === undefined && command !== 'INSERT') throw new RenderRlsError(`${where}: policy without USING`);
  const writes = command === 'ALL' || command === 'INSERT' || command === 'UPDATE';
  if (writes && clauses['WITH CHECK'] === undefined) throw new RenderRlsError(`${where}: write policy without WITH CHECK`);
  if (!writes && clauses['WITH CHECK'] !== undefined) throw new RenderRlsError(`${where}: WITH CHECK on a ${command} policy`);
  if (role === 'platform_definer' && command !== 'SELECT' && command !== 'DELETE') {
    throw new RenderRlsError(`${where}: platform_definer policies are SELECT or DELETE only`);
  }
  for (const [clause, predicate] of Object.entries(clauses)) {
    const reason = checkPredicate(predicate, role, command, extraAtoms);
    if (reason !== null) throw new RenderRlsError(`${where}: ${clause} refused (${reason})`);
  }
}

/** Validates one policy template; returns its comment-free text. Throws {@link RenderRlsError} on any violation. */
export function validateTemplate(name: string, text: string): string {
  const body = stripComments(text);
  for (const match of body.matchAll(PLACEHOLDER)) {
    if (match[1] !== TABLE_PLACEHOLDER) throw new RenderRlsError(`template ${name}: unknown placeholder {{${match[1] ?? ''}}}`);
  }
  if (body.includes('$')) throw new RenderRlsError(`template ${name}: dollar quoting or parameters are not allowed`);
  const trimmed = body.trim();
  if (trimmed === '') throw new RenderRlsError(`template ${name}: empty`);
  if (!trimmed.endsWith(';')) throw new RenderRlsError(`template ${name}: the last statement must end with ";"`);
  const statements = trimmed
    .slice(0, -1)
    .split(';')
    .map((statement) => collapse(statement));
  const extraAtoms = isPolicySetName(name) ? DR_A14_ATOMS[name] : NO_EXTRA_ATOMS;
  statements.forEach((statement, index) => {
    const where = `template ${name} statement ${String(index + 1)}`;
    if (statement.startsWith('CREATE POLICY ')) checkPolicy(statement, where, extraAtoms);
    else if (!STATEMENT_SHAPES.some((shape) => shape.test(statement)))
      throw new RenderRlsError(`${where}: statement outside the template shapes`);
  });
  return body;
}

/** Reads and validates every policy template of `dir`. */
export function loadPolicyTemplates(dir: string = POLICY_TEMPLATE_DIR): TemplateSet {
  const entries = TEMPLATE_NAMES.map((name) => [name, validateTemplate(name, readFileSync(join(dir, `${name}.sql`), 'utf8'))] as const);
  return Object.fromEntries(entries) as TemplateSet;
}

let cachedTemplates: TemplateSet | undefined;
const defaultTemplates = (): TemplateSet => (cachedTemplates ??= loadPolicyTemplates());

// ---------------------------------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------------------------------

/** The template blocks of `entry`, in render order. */
export function blocksFor(entry: Pick<TableClassEntry, 'class' | 'definerRead' | 'definerPurge' | 'policySet'>): TemplateName[] {
  const blocks: TemplateName[] = ['enable-force'];
  if (entry.policySet !== undefined && POLICY_SETS[entry.policySet].class !== entry.class) {
    throw new RenderRlsError(`policySet ${entry.policySet} needs class ${POLICY_SETS[entry.policySet].class}, not ${entry.class}`);
  }
  switch (entry.policySet ?? entry.class) {
    case 'TENANT':
      blocks.push('tenant', 'operator');
      break;
    case 'GUEST_CAPABLE':
      blocks.push('tenant', 'operator', 'guest', 'guest-capable-guard-trigger');
      break;
    case 'USER_OWNED':
      blocks.push('user-owned', 'operator');
      break;
    case 'dr-a14-users':
      blocks.push('dr-a14-users', 'operator');
      break;
    case 'dr-a14-memberships':
      blocks.push('tenant', 'dr-a14-memberships', 'operator');
      break;
    case 'dr-a14-organisations':
      blocks.push('dr-a14-organisations', 'operator');
      break;
    default:
      throw new RenderRlsError(`class ${entry.class} has no RLS block (GLOBAL and SYSTEM tables are on the C1 allow-list)`);
  }
  if (entry.definerRead === true) blocks.push('definer-read');
  if (entry.definerPurge === true) {
    if (entry.definerRead !== true) throw new RenderRlsError('definerPurge requires definerRead');
    blocks.push('definer-purge');
  }
  return blocks;
}

function checkIdentifiers(sql: string): void {
  for (const match of sql.matchAll(/\b(?:p|tg|trg)_[a-z0-9_]+/g)) {
    if (Buffer.byteLength(match[0]) > MAX_IDENTIFIER_LENGTH) {
      throw new RenderRlsError(`rendered identifier ${match[0]} is longer than ${String(MAX_IDENTIFIER_LENGTH)} bytes`);
    }
  }
}

/** Renders the RLS block of one table (pure given `templates`). */
function checkTableName(entry: Pick<TableClassEntry, 'name' | 'policySet'>): void {
  if (!IDENTIFIER.test(entry.name) || Buffer.byteLength(entry.name) > MAX_IDENTIFIER_LENGTH) {
    throw new RenderRlsError(`table name ${JSON.stringify(entry.name)} is not a lowercase SQL identifier`);
  }
  // The DR-A14 atoms name the table they belong to; a set rendered for another table would bind the wrong rows.
  if (entry.policySet !== undefined && POLICY_SETS[entry.policySet].table !== entry.name) {
    throw new RenderRlsError(`policySet ${entry.policySet} belongs to table ${POLICY_SETS[entry.policySet].table}, not ${entry.name}`);
  }
}

/** Renders the RLS block of one table (pure given `templates`). */
export function renderRls(entry: TableClassEntry, templates: TemplateSet = defaultTemplates()): string {
  checkTableName(entry);
  const body = blocksFor(entry)
    .map((block) => templates[block].replace(PLACEHOLDER, entry.name))
    .join('\n\n');
  checkIdentifiers(body);
  const flags = [
    ...(entry.policySet === undefined ? [] : [`policySet ${entry.policySet}`]),
    ...(['definerRead', 'definerPurge'] as const).filter((flag) => entry[flag] === true),
  ];
  const header = `-- RLS for public.${entry.name} (${entry.class}${flags.length > 0 ? `; ${flags.join(', ')}` : ''}), module ${entry.module}: rendered by tools/db/render-rls.ts from prisma/sql/policy-templates; do not edit.`;
  return `${header}\n${body}\n`;
}

/**
 * Renders `trg_<table>__std_columns` for a table flagged `stdColumns` (D-ARCH-091; catalog C15). Any class: the guard
 * protects GLOBAL and SYSTEM tables a runtime role writes as well. Throws for an unflagged table.
 */
export function renderStdColumnsGuard(entry: TableClassEntry, templates: TemplateSet = defaultTemplates()): string {
  checkTableName(entry);
  if (entry.stdColumns !== true) throw new RenderRlsError(`table ${entry.name} is not flagged stdColumns`);
  const body = templates['std-columns-guard-trigger'].replace(PLACEHOLDER, entry.name);
  checkIdentifiers(body);
  return `-- Standard-columns guard for public.${entry.name}, module ${entry.module}: rendered by tools/db/render-rls.ts from prisma/sql/policy-templates; do not edit.\n${body}\n`;
}

/** Renders every RLS table of `module` and the guard trigger of every `stdColumns` table (manifest order: by name). */
export function renderModule(module: string, entries: readonly TableClassEntry[], templates: TemplateSet = defaultTemplates()): string {
  const tables = entries.filter((entry) => entry.module === module);
  if (tables.length === 0) throw new RenderRlsError(`no manifest lists module "${module}"`);
  return tables
    .flatMap((entry) => [
      ...(RLS_CLASSES.has(entry.class) ? [renderRls(entry, templates)] : []),
      ...(entry.stdColumns === true ? [renderStdColumnsGuard(entry, templates)] : []),
    ])
    .join('\n');
}

/** The once-per-database `platform.guest_capable_guard()` trigger function (TASK-051 ships it). */
export function renderGuestCapableGuardFunction(dir: string = POLICY_TEMPLATE_DIR): string {
  const body = stripComments(readFileSync(join(dir, `${GUARD_FUNCTION_TEMPLATE}.sql`), 'utf8'));
  const code = collapse(body);
  if (/SECURITY\s+DEFINER/i.test(code)) throw new RenderRlsError('the guard function must not be SECURITY DEFINER');
  if (!code.includes('SET search_path = pg_catalog, pg_temp AS $$'))
    throw new RenderRlsError('the guard function needs the fixed search path');
  if (body.match(PLACEHOLDER) !== null) throw new RenderRlsError('the guard function takes no placeholder');
  return `${body}\n`;
}

/**
 * The once-per-database `platform.std_columns_guard()` trigger function (data-model §7.6 amendment of 2026-11-13;
 * D-ARCH-091): checked for the C15 (b) properties before it is handed out, so a template edit that breaks them fails at
 * render time as well as in the catalog suite.
 */
export function renderStdColumnsGuardFunction(dir: string = FUNCTION_TEMPLATE_DIR): string {
  const body = stripComments(readFileSync(join(dir, `${STD_COLUMNS_GUARD_FUNCTION_TEMPLATE}.sql`), 'utf8'));
  const code = collapse(body);
  if (!code.startsWith('CREATE FUNCTION platform.std_columns_guard() RETURNS trigger LANGUAGE plpgsql '))
    throw new RenderRlsError('the standard-columns guard must be a plain CREATE FUNCTION platform.std_columns_guard() in plpgsql');
  if (/SECURITY\s+DEFINER/i.test(code)) throw new RenderRlsError('the standard-columns guard must not be SECURITY DEFINER');
  if (!code.includes('SET search_path = pg_catalog, pg_temp AS $$'))
    throw new RenderRlsError('the standard-columns guard needs the fixed search path');
  if (/\b(?:current_setting|set_config)\s*\(/i.test(code))
    throw new RenderRlsError('the standard-columns guard reads the actor through platform.app_actor_id() only');
  if (/\bNEW\s*\.\s*[a-z_]+\s*:=/i.test(code)) throw new RenderRlsError('the standard-columns guard asserts and never assigns');
  if (body.match(PLACEHOLDER) !== null) throw new RenderRlsError('the standard-columns guard takes no placeholder');
  return `${body}\n`;
}

export function main(argv: readonly string[], out: (text: string) => void, err: (text: string) => void, manifestDir?: string): number {
  const [module, ...rest] = argv;
  if (module === undefined || rest.length > 0) {
    err('usage: tsx tools/db/render-rls.ts <module>\n');
    return 2;
  }
  try {
    const rendered = renderModule(module, loadTableClasses(manifestDir));
    out(rendered === '' ? `-- module ${module} has no RLS table\n` : rendered);
    return 0;
  } catch (error) {
    err(`[render-rls] ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = main(
    process.argv.slice(2),
    (text) => process.stdout.write(text),
    (text) => process.stderr.write(text),
  );
}
