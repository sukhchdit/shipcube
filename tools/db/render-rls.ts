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

import { RLS_CLASSES, loadTableClasses, type TableClassEntry } from './table-classes.js';

export const POLICY_TEMPLATE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'prisma', 'sql', 'policy-templates');

export const TEMPLATE_NAMES = [
  'enable-force',
  'tenant',
  'operator',
  'guest',
  'user-owned',
  'definer-read',
  'definer-purge',
  'guest-capable-guard-trigger',
] as const;
export type TemplateName = (typeof TEMPLATE_NAMES)[number];
export type TemplateSet = Readonly<Record<TemplateName, string>>;

export const GUARD_FUNCTION_TEMPLATE = 'guest-capable-guard-function';

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

/** Returns the reason a policy predicate is refused, or `null` when it is on the allow-list. */
export function checkPredicate(predicate: string, role: string, command: string): string | null {
  const text = collapse(predicate);
  for (const [token, pattern] of FORBIDDEN_PREDICATE_TOKENS) {
    if (pattern.test(text)) return `forbidden token ${token}`;
  }
  if (role === 'platform_definer') {
    const expected = DEFINER_PREDICATES[command];
    return expected !== undefined && text === expected ? null : `predicate not allowed for platform_definer FOR ${command}`;
  }
  const conjuncts = splitConjuncts(text);
  for (const conjunct of conjuncts) {
    if (!KEYED_ATOMS.has(conjunct) && !UNKEYED_ATOMS.has(conjunct)) {
      return /current_setting\s*\(/i.test(conjunct)
        ? 'raw current_setting( outside the helpers'
        : `predicate atom not on the allow-list: ${conjunct}`;
    }
  }
  if (!conjuncts.some((conjunct) => KEYED_ATOMS.has(conjunct))) return 'predicate has no keyed atom';
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
];
const POLICY_HEAD = new RegExp(
  `^CREATE POLICY p_${T}__([a-z_]+) ON public\\.${T} FOR (ALL|SELECT|INSERT|UPDATE|DELETE) TO (platform_app|platform_definer)`,
);

function checkPolicy(statement: string, where: string): void {
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
    const reason = checkPredicate(predicate, role, command);
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
  statements.forEach((statement, index) => {
    const where = `template ${name} statement ${String(index + 1)}`;
    if (statement.startsWith('CREATE POLICY ')) checkPolicy(statement, where);
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
export function blocksFor(entry: Pick<TableClassEntry, 'class' | 'definerRead' | 'definerPurge'>): TemplateName[] {
  const blocks: TemplateName[] = ['enable-force'];
  switch (entry.class) {
    case 'TENANT':
      blocks.push('tenant', 'operator');
      break;
    case 'GUEST_CAPABLE':
      blocks.push('tenant', 'operator', 'guest', 'guest-capable-guard-trigger');
      break;
    case 'USER_OWNED':
      blocks.push('user-owned', 'operator');
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
  for (const match of sql.matchAll(/\b(?:p|tg)_[a-z0-9_]+/g)) {
    if (Buffer.byteLength(match[0]) > MAX_IDENTIFIER_LENGTH) {
      throw new RenderRlsError(`rendered identifier ${match[0]} is longer than ${String(MAX_IDENTIFIER_LENGTH)} bytes`);
    }
  }
}

/** Renders the RLS block of one table (pure given `templates`). */
export function renderRls(entry: TableClassEntry, templates: TemplateSet = defaultTemplates()): string {
  if (!IDENTIFIER.test(entry.name) || Buffer.byteLength(entry.name) > MAX_IDENTIFIER_LENGTH) {
    throw new RenderRlsError(`table name ${JSON.stringify(entry.name)} is not a lowercase SQL identifier`);
  }
  const body = blocksFor(entry)
    .map((block) => templates[block].replace(PLACEHOLDER, entry.name))
    .join('\n\n');
  checkIdentifiers(body);
  const flags = (['definerRead', 'definerPurge'] as const).filter((flag) => entry[flag] === true);
  const header = `-- RLS for public.${entry.name} (${entry.class}${flags.length > 0 ? `; ${flags.join(', ')}` : ''}), module ${entry.module}: rendered by tools/db/render-rls.ts from prisma/sql/policy-templates; do not edit.`;
  return `${header}\n${body}\n`;
}

/** Renders every RLS table of `module` (manifest order: by table name). */
export function renderModule(module: string, entries: readonly TableClassEntry[], templates: TemplateSet = defaultTemplates()): string {
  const tables = entries.filter((entry) => entry.module === module);
  if (tables.length === 0) throw new RenderRlsError(`no manifest lists module "${module}"`);
  return tables
    .filter((entry) => RLS_CLASSES.has(entry.class))
    .map((entry) => renderRls(entry, templates))
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
