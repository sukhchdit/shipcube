/**
 * Suppression-comment policy (NFR-MAINT-002, PR2-SEC-01 items 1/2/4, US-048). The third step of `npm run lint`, after
 * ESLint and Stylelint, because a policy written as an ESLint rule can itself be switched off inline.
 *
 * Scans the repository's tracked (and untracked, not ignored) source files and enforces:
 *  - no inline rule configuration (`/* eslint rule: … *\/`, `eslint-env`, `global`/`globals`);
 *  - no blanket `eslint-disable*` / `stylelint-disable*` (no rule list), whatever the description says;
 *  - no `@ts-ignore` / `@ts-nocheck` (use `@ts-expect-error` with a linked task);
 *  - no suppression of a protected security/architecture rule: exceptions to those are file-scoped overrides in the
 *    code-owned lint configuration (PR2-SEC-08), never inline;
 *  - no Semgrep (`nosem`, `nosemgrep`) or Gitleaks (`gitleaks:allow`) suppressions at all (Semgrep also runs with
 *    `--disable-nosem`);
 *  - every remaining suppression (`eslint-disable*`, `stylelint-disable*`, `@ts-expect-error`, `istanbul`/`c8`/`v8`
 *    ignore) carries a description with a linked `TASK-\d{3}` ID.
 * It prints the count per kind and per suppressed rule (the NFR-MAINT-002 evidence).
 *
 * Usage: node tools/lint/check-suppressions.mjs [--root <dir>] [--summary <file>] [--json]
 * Exit 0 = pass, 1 = policy finding(s), 2 = usage or internal error.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

/** Rules that are never suppressed inline (PR2-SEC-01 remediation 1 (c), PR2-SEC-02/05, brief TASK-007). */
export const PROTECTED_RULES = Object.freeze([
  'no-restricted-imports',
  'no-restricted-syntax',
  'boundaries/*',
  'platform/no-innerhtml',
  'platform/outbound-http-via-client',
  'platform/audit-writer-allowlist',
  'platform/money-arith',
  'platform/pricing-purity', // PR080-SEC-01: the engine's purity (AT-US-138-02) is never waived inline
  'platform/node-path-only',
  'platform/any-justification',
  'platform/password-hasher-only',
  'platform/prisma-client-construction',
  'platform/hover-in-media',
  'import-x/no-relative-packages',
  'import-x/no-extraneous-dependencies',
  '@typescript-eslint/ban-ts-comment',
  'csstools/use-logical',
]);

/** Paths that contain suppressions on purpose (seeded fixtures) or only describe them (docs, this checker). */
export const EXCLUDED_PREFIXES = Object.freeze(['docs/', '.claude/', 'tests/fixtures/lint/', 'tests/fixtures/semgrep/']);
export const EXCLUDED_FILES = Object.freeze(['tools/lint/check-suppressions.mjs', 'tools/lint/check-suppressions.test.ts']);

const JS_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx']);
const CSS_EXTENSIONS = new Set(['.css']);
const HASH_EXTENSIONS = new Set(['.yml', '.yaml', '.toml', '.sh']);
const HASH_FILES = new Set(['.env.example', '.npmrc', '.gitleaks.toml']);

const TASK_ID = /\bTASK-\d{3}\b/u;
const GITLEAKS_ALLOW = /gitleaks:allow/u;
const NOSEMGREP_LEADING = /^\s*nosem(?:grep)?\b/u;
const NOSEMGREP_ANYWHERE = /\bnosem(?:grep)?\s*:/u;
const RULE_DIRECTIVE = /^(eslint-disable(?:-next-line|-line)?|stylelint-disable(?:-next-line|-line)?)(?=\s|$)([^]*)$/u;
const INLINE_CONFIG = /^(eslint(?=\s)|eslint-env(?=\s|$)|globals?(?=\s))/u;
const TS_DIRECTIVE = /^@(ts-ignore|ts-nocheck|ts-expect-error)\b([^]*)$/u;
const COVERAGE_DIRECTIVE = /^((?:istanbul|c8|v8)\s+ignore)\b([^]*)$/u;

/**
 * @typedef {'eslint-disable' | 'stylelint-disable' | 'inline-config' | 'ts-ignore' | 'ts-nocheck' | 'ts-expect-error'
 *   | 'coverage-ignore' | 'nosemgrep' | 'gitleaks-allow'} SuppressionKind
 * @typedef {{ kind: SuppressionKind; directive: string; rules: string[]; description: string; line: number }} Suppression
 * @typedef {{ rule: string; message: string; location: string }} Finding
 * @typedef {{ files: number; total: number; byKind: Record<string, number>; byRule: Record<string, number> }} Summary
 * @typedef {{ value: string; line: number; block: boolean }} Comment
 */

// ---------------------------------------------------------------------------------------------------------------
// Comment extraction (no dependency: a small lexer that skips strings, template literals and regex literals)
// ---------------------------------------------------------------------------------------------------------------

const REGEX_AFTER_KEYWORDS = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
]);
const IDENTIFIER_START = /[\p{L}_$]/u;
const IDENTIFIER_PART = /[\p{L}\p{N}_$]/u;

/**
 * @param {string} text
 * @param {number} from
 * @param {number} to
 */
const newlinesIn = (text, from, to) => {
  let count = 0;
  for (let i = from; i < to; i += 1) if (text[i] === '\n') count += 1;
  return count;
};

/**
 * Index just after the closing quote of the string starting at `start`.
 * @param {string} text
 * @param {number} start
 */
function skipQuoted(text, start) {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length && text[i] !== quote && text[i] !== '\n') i += text[i] === '\\' ? 2 : 1;
  return Math.min(i + 1, text.length);
}

/**
 * Index just after the regex literal starting at `start` (including flags).
 * @param {string} text
 * @param {number} start
 */
function skipRegex(text, start) {
  let i = start + 1;
  let inClass = false;
  while (i < text.length && text[i] !== '\n') {
    const c = text[i];
    if (c === '\\') i += 2;
    else {
      if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) break;
      i += 1;
    }
  }
  i += 1;
  while (i < text.length && IDENTIFIER_PART.test(text[i] ?? '')) i += 1;
  return i;
}

/**
 * Extracts every comment of a JavaScript/TypeScript source (line and block comments, with the 1-based start line).
 * @param {string} text
 * @returns {Comment[]}
 */
export function extractJsComments(text) {
  /** @type {Comment[]} */
  const comments = [];
  /** Brace depths at which an open template literal resumes (`${ … }` nesting). */
  /** @type {number[]} */
  const templates = [];
  let depth = 0;
  let line = 1;
  let regexAllowed = true;
  let i = 0;

  /** Scans template characters from `i` until the closing backtick or a `${`. */
  const scanTemplate = () => {
    while (i < text.length) {
      const c = text[i];
      if (c === '\\') {
        line += text[i + 1] === '\n' ? 1 : 0;
        i += 2;
      } else if (c === '`') {
        i += 1;
        regexAllowed = false;
        return;
      } else if (c === '$' && text[i + 1] === '{') {
        i += 2;
        depth += 1;
        templates.push(depth);
        regexAllowed = true;
        return;
      } else {
        line += c === '\n' ? 1 : 0;
        i += 1;
      }
    }
  };

  while (i < text.length) {
    const c = text[i] ?? '';
    const next = text[i + 1];
    if (c === '\n') {
      line += 1;
      i += 1;
    } else if (/\s/u.test(c)) {
      i += 1;
    } else if (c === '/' && next === '/') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      comments.push({ value: text.slice(i + 2, stop), line, block: false });
      i = stop;
    } else if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end;
      comments.push({ value: text.slice(i + 2, stop), line, block: true });
      line += newlinesIn(text, i, stop);
      i = Math.min(stop + 2, text.length);
    } else if (c === '"' || c === "'") {
      const stop = skipQuoted(text, i);
      line += newlinesIn(text, i, stop);
      i = stop;
      regexAllowed = false;
    } else if (c === '`') {
      i += 1;
      scanTemplate();
    } else if (c === '/' && regexAllowed) {
      i = skipRegex(text, i);
      regexAllowed = false;
    } else if (IDENTIFIER_START.test(c) || /\d/u.test(c)) {
      const start = i;
      while (i < text.length && IDENTIFIER_PART.test(text[i] ?? '')) i += 1;
      regexAllowed = REGEX_AFTER_KEYWORDS.has(text.slice(start, i));
    } else if (c === '{') {
      depth += 1;
      i += 1;
      regexAllowed = true;
    } else if (c === '}') {
      i += 1;
      if (templates.at(-1) === depth) {
        templates.pop();
        depth -= 1;
        scanTemplate();
      } else {
        depth -= 1;
        regexAllowed = true;
      }
    } else {
      i += 1;
      regexAllowed = c !== ')' && c !== ']';
    }
  }
  return comments;
}

/**
 * Extracts the block comments of a CSS source.
 * @param {string} text
 * @returns {Comment[]}
 */
export function extractCssComments(text) {
  /** @type {Comment[]} */
  const comments = [];
  let line = 1;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '\n') {
      line += 1;
      i += 1;
    } else if (c === '"' || c === "'") {
      const stop = skipQuoted(text, i);
      line += newlinesIn(text, i, stop);
      i = stop;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end;
      comments.push({ value: text.slice(i + 2, stop), line, block: true });
      line += newlinesIn(text, i, stop);
      i = Math.min(stop + 2, text.length);
    } else {
      i += 1;
    }
  }
  return comments;
}

// ---------------------------------------------------------------------------------------------------------------
// Directive parsing
// ---------------------------------------------------------------------------------------------------------------

/**
 * Splits `rule-a, rule-b -- reason` on the first ` -- ` (ESLint and Stylelint use the same separator).
 * @param {string} rest
 * @returns {{ rules: string[]; description: string }}
 */
export function splitDirective(rest) {
  const separator = /(?:^|\s)--(?:\s|$)/u.exec(rest);
  const rulesPart = separator ? rest.slice(0, separator.index) : rest;
  const description = separator ? rest.slice(separator.index + separator[0].length).trim() : '';
  const rules = rulesPart
    .split(',')
    .map((rule) => rule.trim())
    .filter((rule) => rule !== '');
  return { rules, description };
}

/**
 * Classifies one comment; null when it is not a suppression.
 * @param {string} raw the comment value (without the comment markers)
 * @param {number} line
 * @param {boolean} [block] ESLint reads inline configuration (`eslint`, `eslint-env`, `global`) from block comments only
 * @returns {Suppression | null}
 */
export function parseComment(raw, line, block = true) {
  const value = raw.trim();
  const ruleDirective = RULE_DIRECTIVE.exec(value);
  if (ruleDirective) {
    const [, directive = '', rest = ''] = ruleDirective;
    const { rules, description } = splitDirective(rest);
    const kind = directive.startsWith('eslint') ? 'eslint-disable' : 'stylelint-disable';
    return { kind, directive, rules, description, line };
  }
  const inline = block ? INLINE_CONFIG.exec(value) : null;
  if (inline) return { kind: 'inline-config', directive: inline[1] ?? '', rules: [], description: '', line };
  const ts = TS_DIRECTIVE.exec(value);
  if (ts) {
    const [, directive = '', rest = ''] = ts;
    return {
      kind: /** @type {SuppressionKind} */ (directive),
      directive: `@${directive}`,
      rules: [],
      description: rest.replace(/^\s*(?:--|:)?\s*/u, '').trim(),
      line,
    };
  }
  const coverage = COVERAGE_DIRECTIVE.exec(value);
  if (coverage) {
    const [, directive = '', rest = ''] = coverage;
    return { kind: 'coverage-ignore', directive, rules: [], description: rest.trim(), line };
  }
  if (NOSEMGREP_LEADING.test(value) || NOSEMGREP_ANYWHERE.test(value)) {
    return { kind: 'nosemgrep', directive: 'nosemgrep', rules: [], description: '', line };
  }
  return null;
}

/** @param {string} path */
function fileKind(path) {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  const extension = dot === -1 ? '' : name.slice(dot).toLowerCase();
  if (JS_EXTENSIONS.has(extension)) return 'js';
  if (CSS_EXTENSIONS.has(extension)) return 'css';
  if (HASH_EXTENSIONS.has(extension) || HASH_FILES.has(name) || name.startsWith('Dockerfile')) return 'hash';
  return null;
}

/** @param {string} path */
export function isScanned(path) {
  if (EXCLUDED_FILES.includes(path) || EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix))) return false;
  return fileKind(path) !== null;
}

/**
 * Every suppression in one file.
 * @param {string} text
 * @param {string} path repository-relative, forward slashes
 * @returns {Suppression[]}
 */
export function scanText(text, path) {
  const kind = fileKind(path);
  /** @type {Suppression[]} */
  const found = [];
  if (kind === 'js' || kind === 'css') {
    const comments = kind === 'js' ? extractJsComments(text) : extractCssComments(text);
    for (const comment of comments) {
      const suppression = parseComment(comment.value, comment.line, comment.block);
      if (suppression) found.push(suppression);
    }
  } else if (kind === 'hash') {
    text.split('\n').forEach((content, index) => {
      const hash = content.indexOf('#');
      if (hash !== -1 && parseComment(content.slice(hash + 1), index + 1, false)?.kind === 'nosemgrep') {
        found.push({ kind: 'nosemgrep', directive: 'nosemgrep', rules: [], description: '', line: index + 1 });
      }
    });
  }
  // Gitleaks honours its marker anywhere on a line, in any file type.
  text.split('\n').forEach((content, index) => {
    if (GITLEAKS_ALLOW.test(content)) {
      found.push({ kind: 'gitleaks-allow', directive: 'gitleaks:allow', rules: [], description: '', line: index + 1 });
    }
  });
  return found.sort((a, b) => a.line - b.line);
}

/** @param {string} rule */
export function isProtected(rule) {
  return PROTECTED_RULES.some((entry) => (entry.endsWith('/*') ? rule.startsWith(entry.slice(0, -1)) : rule === entry));
}

/**
 * Policy findings for one suppression.
 * @param {Suppression} suppression
 * @param {string} location
 * @returns {Finding[]}
 */
export function evaluate(suppression, location) {
  const { kind, directive, rules, description } = suppression;
  /** @type {Finding[]} */
  const findings = [];
  const finding = (/** @type {string} */ rule, /** @type {string} */ message) => findings.push({ rule, message, location });
  switch (kind) {
    case 'inline-config':
      finding(
        'suppression/inline-config',
        `inline '${directive}' configuration is forbidden; configure rules in eslint.config.mjs (PR2-SEC-01)`,
      );
      return findings;
    case 'nosemgrep':
      finding('suppression/semgrep', 'Semgrep suppressions are forbidden; Semgrep runs with --disable-nosem (PR2-SEC-01, PR2-SEC-02)');
      return findings;
    case 'gitleaks-allow':
      finding('suppression/gitleaks', 'inline Gitleaks allow markers are forbidden; use a reviewed .gitleaks.toml allowlist (US-048)');
      return findings;
    case 'ts-ignore':
    case 'ts-nocheck':
      finding('suppression/ts-ignore', `'${directive}' is forbidden; use '@ts-expect-error -- TASK-xxx <reason>' (NFR-MAINT-002)`);
      return findings;
    default:
      break;
  }
  if ((kind === 'eslint-disable' || kind === 'stylelint-disable') && rules.length === 0) {
    finding('suppression/blanket', `blanket '${directive}' is forbidden; name the rule(s) it suppresses (PR2-SEC-01)`);
  }
  for (const rule of rules.filter(isProtected)) {
    finding(
      'suppression/protected-rule',
      `'${rule}' is a protected rule and is never suppressed inline; exceptions are file-scoped overrides in the lint config (PR2-SEC-01)`,
    );
  }
  if (!TASK_ID.test(description)) {
    finding('suppression/missing-task-id', `'${directive}' needs a description with a linked task: '-- TASK-xxx <reason>' (NFR-MAINT-002)`);
  }
  return findings;
}

/**
 * Pure core: evaluates the given files.
 * @param {ReadonlyArray<{ path: string; text: string }>} files
 * @returns {{ findings: Finding[]; summary: Summary }}
 */
export function checkSuppressions(files) {
  /** @type {Finding[]} */
  const findings = [];
  /** @type {Summary} */
  const summary = { files: 0, total: 0, byKind: {}, byRule: {} };
  for (const { path, text } of files) {
    if (!isScanned(path)) continue;
    summary.files += 1;
    for (const suppression of scanText(text, path)) {
      summary.total += 1;
      summary.byKind[suppression.kind] = (summary.byKind[suppression.kind] ?? 0) + 1;
      for (const rule of suppression.rules.length > 0 ? suppression.rules : ['(all rules)']) {
        const key = `${suppression.kind}: ${rule}`;
        summary.byRule[key] = (summary.byRule[key] ?? 0) + 1;
      }
      findings.push(...evaluate(suppression, `${path}:${suppression.line}`));
    }
  }
  return { findings, summary };
}

/**
 * Tracked plus untracked-but-not-ignored files (so a local run sees a new file before it is committed).
 * @param {string} root
 * @returns {string[]}
 */
export function listRepositoryFiles(root) {
  const output = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 30_000,
    windowsHide: true,
  });
  return [...new Set(output.split('\0').filter((path) => path !== ''))].sort();
}

/**
 * @param {Summary} summary
 * @param {Finding[]} findings
 */
export function toMarkdown(summary, findings) {
  const rows = Object.entries(summary.byRule)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([rule, count]) => `| \`${rule}\` | ${String(count)} |`);
  return [
    '### Suppression comments (NFR-MAINT-002)',
    '',
    `${String(summary.total)} suppression(s) in ${String(summary.files)} scanned file(s); ${String(findings.length)} policy finding(s).`,
    '',
    ...(rows.length > 0 ? ['| Kind: rule | Count |', '|---|---|', ...rows, ''] : []),
  ].join('\n');
}

/**
 * @param {string[]} argv
 * @returns {{ root: string; summaryFile: string | undefined; json: boolean }}
 */
export function parseArgs(argv) {
  let root = process.cwd();
  /** @type {string | undefined} */
  let summaryFile;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') json = true;
    else if (arg === '--root' || arg === '--summary') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      if (arg === '--root') root = resolve(value);
      else summaryFile = value;
      i += 1;
    } else throw new Error(`unknown argument '${String(arg)}'`);
  }
  return { root, summaryFile, json };
}

/**
 * @param {string[]} argv
 * @returns {number} exit code
 */
export function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`check-suppressions: ${error instanceof Error ? error.message : String(error)}`);
    console.error('usage: node tools/lint/check-suppressions.mjs [--root <dir>] [--summary <file>] [--json]');
    return 2;
  }
  const { root, summaryFile, json } = options;
  let result;
  try {
    const files = listRepositoryFiles(root)
      .filter(isScanned)
      .flatMap((path) => {
        try {
          return [{ path, text: readFileSync(join(root, path), 'utf8') }];
        } catch (error) {
          // A tracked file deleted in the working tree has nothing left to suppress.
          if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return [];
          throw error;
        }
      });
    result = checkSuppressions(files);
  } catch (error) {
    console.error(`check-suppressions: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const { findings, summary } = result;
  if (json) {
    process.stdout.write(`${JSON.stringify({ findings, summary }, null, 2)}\n`);
  } else {
    for (const { rule, message, location } of findings) console.error(`${rule}: ${message} (${location})`);
    const kinds = Object.entries(summary.byKind).map(([kind, count]) => `${kind}=${String(count)}`);
    console.log(
      `check-suppressions: ${String(summary.total)} suppression(s) in ${String(summary.files)} file(s)` +
        `${kinds.length > 0 ? ` [${kinds.join(', ')}]` : ''}; ${String(findings.length)} finding(s)`,
    );
    for (const [rule, count] of Object.entries(summary.byRule).sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`  ${rule}: ${String(count)}`);
    }
  }
  if (summaryFile !== undefined) appendFileSync(summaryFile, `${toMarkdown(summary, findings)}\n`);
  return findings.length > 0 ? 1 : 0;
}

// `import.meta.main` is Node's own entry-point test (Node >= 24.2; see tools/deps/rebuild.mjs). Fail closed without it.
if (typeof import.meta.main !== 'boolean') {
  throw new Error('check-suppressions needs Node >= 24.2 (import.meta.main); see .node-version');
}
if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2));
}
