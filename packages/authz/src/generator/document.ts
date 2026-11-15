/**
 * The committed RBAC route matrix (US-071 AT-US-071-04/-05; TASK-027): rendering the generated matrix as a Markdown
 * document, reading a committed one back and naming every difference. Pure: the writer (`npm run authz:matrix`,
 * tests/generated/rbac/write-matrix.ts) puts the document at `ROUTE_MATRIX_PATH`; the drift test compares the
 * committed file with the generator output and fails naming the route, the role (column) or the cell that changed, so
 * a new route, a new role or a changed seeded grant cannot ship without the matrix being regenerated and reviewed.
 */
import { type CellOutcome, type MatrixCaller, type MatrixRoute, type RouteMatrix } from './matrix.js';

/** Regenerates the committed route matrix (root script). */
export const ROUTE_MATRIX_COMMAND = 'npm run authz:matrix';

/** Repository-relative path of the committed route matrix. */
export const ROUTE_MATRIX_PATH = 'docs/03-architecture/generated/rbac-route-matrix.md';

/** Cell symbols; `-` is a caller that does not apply to the route (a signature on a non-signature route). */
export const CELL_SYMBOLS: Readonly<Record<CellOutcome, string>> = {
  allow: 'Y',
  'deny-401': '401',
  'deny-403': '403',
  'deny-403-mfa': 'MFA',
};
export const NOT_APPLICABLE = '-';

const HEADER_PREFIX = ['Operation', 'Route', 'Permission', 'Auth'] as const;
const row = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`;

/** The four metadata cells of a route's row. */
function metadataCells(route: MatrixRoute): string[] {
  const exempt = route.mfaGateExempt === true ? ' (MFA-exempt)' : '';
  const dual = route.permissionAuthenticated === undefined ? '' : ` / session: \`${route.permissionAuthenticated}\``;
  return [
    `\`${route.operationId}\``,
    `\`${route.method.toUpperCase()} ${route.path}\``,
    `\`${route.permission}\`${dual}${exempt}`,
    route.auth.join(', '),
  ];
}

/** The matrix as the committed Markdown document. */
export function renderRouteMatrix(matrix: RouteMatrix, version: number): string {
  const columns = matrix.callers.map((caller) => caller.id);
  const lines = [
    `<!-- GENERATED FILE: do not edit. Regenerate with \`${ROUTE_MATRIX_COMMAND}\` (source: openapi.yaml route metadata and the packages/authz role seed). -->`,
    '',
    '# RBAC route matrix',
    '',
    `Catalogue version: **${String(version)}**. One row per operation of openapi.yaml, one column per caller: no credential, each seeded role (an operator role first without, then with a verified second factor: \`<ROLE>+mfa\`), an expired bearer, a valid and an unknown refresh cookie, a valid and an unknown guest quote token, and on signature routes a provider signature with and without the route's permission (US-071, ADR-0008 am. 4 and 5, D-ARCH-107/109/110). The \`rbac-matrix\` suite runs every cell through the API pipeline; CI fails when this file differs from the generator output.`,
    '',
    `Cells: \`${CELL_SYMBOLS.allow}\` allowed; \`${CELL_SYMBOLS['deny-401']}\` AUTH_REQUIRED; \`${CELL_SYMBOLS['deny-403']}\` AUTHZ_DENIED (permission gate); \`${CELL_SYMBOLS['deny-403-mfa']}\` AUTHZ_DENIED (staff MFA gate); \`${NOT_APPLICABLE}\` not applicable. A caller whose credential the route does not accept gets the \`none\` cell (D-ARCH-109).`,
    '',
    row([...HEADER_PREFIX, ...columns]),
    row([...HEADER_PREFIX.map(() => '---'), ...columns.map(() => ':-:')]),
  ];
  for (const { route, cells } of matrix.rows) {
    const byCaller = new Map(cells.map((cell) => [cell.caller, CELL_SYMBOLS[cell.outcome]]));
    lines.push(row([...metadataCells(route), ...columns.map((column) => byCaller.get(column) ?? NOT_APPLICABLE)]));
  }
  lines.push('', `${String(matrix.rows.length)} operations x ${String(columns.length)} callers.`, '');
  return lines.join('\n');
}

/** One row of a committed matrix: its metadata cells and its cells by column. */
export interface CommittedRow {
  readonly metadata: string;
  readonly cells: ReadonlyMap<string, string>;
}

export interface CommittedMatrix {
  readonly columns: readonly string[];
  /** operationId -> row. */
  readonly rows: ReadonlyMap<string, CommittedRow>;
}

const splitRow = (line: string): string[] =>
  line
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());

const unquote = (cell: string): string => cell.replace(/^`(.*)`$/u, '$1');

/** Reads a rendered (or hand-edited) document back; a document without the table reads as empty. */
export function parseRouteMatrix(text: string): CommittedMatrix {
  const lines = text.split('\n');
  const headerLine = lines.find((line) => line.startsWith(`| ${HEADER_PREFIX.join(' | ')} |`));
  if (headerLine === undefined) return { columns: [], rows: new Map() };
  const header = lines.indexOf(headerLine);
  const columns = splitRow(headerLine).slice(HEADER_PREFIX.length);
  const rows = new Map<string, CommittedRow>();
  for (const line of lines.slice(header + 2)) {
    if (!line.startsWith('| ')) break;
    const cells = splitRow(line);
    rows.set(unquote(String(cells[0])), {
      metadata: cells.slice(0, HEADER_PREFIX.length).join(' | '),
      cells: new Map(columns.map((column, index) => [column, cells[HEADER_PREFIX.length + index] ?? ''])),
    });
  }
  return { columns, rows };
}

const describeCaller = (caller: MatrixCaller): string => `${caller.kind === 'role' ? 'role' : 'caller'} ${caller.id}`;

export interface DriftOptions {
  /**
   * `full` (the committed document against the contract): a committed row or column without a generated one is named
   * too. `subset` (the mounted routes against the committed document): only generated rows are checked.
   */
  readonly mode: 'full' | 'subset';
}

/**
 * Every difference between a committed matrix and the generated one, each naming its route, role or cell: a generated
 * column (role or caller) or row (route) missing from the committed matrix, a committed one that is no longer
 * generated (full mode), a changed route metadata cell and every changed cell. Empty = up to date.
 */
export function matrixDrift(committed: CommittedMatrix, generated: RouteMatrix, options: DriftOptions = { mode: 'full' }): string[] {
  const findings: string[] = [];
  const callers = new Map(generated.callers.map((caller) => [caller.id, caller]));
  const committedColumns = new Set(committed.columns);
  for (const caller of generated.callers) {
    if (!committedColumns.has(caller.id)) findings.push(`${describeCaller(caller)} has no column in the committed matrix`);
  }
  if (options.mode === 'full') {
    for (const column of committed.columns) {
      if (!callers.has(column)) findings.push(`column ${column} of the committed matrix is no longer generated (a removed role or caller)`);
    }
  }
  const generatedIds = new Set<string>();
  for (const { route, cells } of generated.rows) {
    generatedIds.add(route.operationId);
    const name = `${route.method.toUpperCase()} ${route.path} (${route.operationId})`;
    const committedRow = committed.rows.get(route.operationId);
    if (committedRow === undefined) {
      findings.push(`route ${name} has no row in the committed matrix`);
      continue;
    }
    if (options.mode === 'full' && committedRow.metadata !== metadataCells(route).join(' | ')) {
      findings.push(`route ${name}: committed metadata "${committedRow.metadata}" differs from "${metadataCells(route).join(' | ')}"`);
    }
    const byCaller = new Map(cells.map((cell) => [cell.caller, CELL_SYMBOLS[cell.outcome]]));
    for (const caller of generated.callers) {
      const expected = byCaller.get(caller.id) ?? NOT_APPLICABLE;
      const actual = committedRow.cells.get(caller.id);
      if (actual !== undefined && actual !== expected) {
        findings.push(`route ${name} x ${describeCaller(caller)}: committed ${actual}, generated ${expected}`);
      }
    }
  }
  if (options.mode === 'full') {
    for (const operationId of committed.rows.keys()) {
      if (!generatedIds.has(operationId)) findings.push(`committed row ${operationId} has no route (a removed operation)`);
    }
  }
  return findings;
}
