// @ts-check
/**
 * Strict parser for the YAML subset our GitHub workflow and Dependabot files use (TASK-007). The repository has no
 * YAML parser as a direct dependency and the CI checkers add none (CLAUDE.md §5 dependency rule), so this module reads
 * exactly the block-style subset we write and REJECTS everything else instead of guessing:
 *
 *   supported   block mappings, block sequences (also `key:` followed by `- item` at the same indent), `- key: value`
 *               sequence items, plain / 'single' / "double" quoted scalars, `|` and `>` block scalars (with `-`/`+`
 *               chomping), flow sequences of scalars (`[a, 'b']`), the empty flow mapping `{}`, `#` comments.
 *   rejected    anchors `&`, aliases `*`, merge keys `<<`, tags `!`, directives, `---`/`...` document markers, flow
 *               mappings other than `{}`, nested flow collections, multi-line plain or quoted scalars, tabs in
 *               indentation, duplicate keys, keys containing `: `, and (anywhere, comments included) a CR not followed
 *               by LF, NEL U+0085, LS U+2028, PS U+2029, C0 controls other than TAB/LF/CRLF, and U+FEFF other than as
 *               the first character (line-break differential, code review m1).
 *
 * A rejected construct is a finding for the caller (`yaml-subset`): a workflow the checker cannot read with certainty
 * must not pass the policy. Scalars stay strings (`true`, `1` and `on` are not converted).
 */

/** @typedef {string | YamlSeq | YamlMap} YamlNode */
/** @typedef {YamlNode[]} YamlSeq */
/** @typedef {{ [key: string]: YamlNode }} YamlMap */
/** @typedef {{ value: YamlNode | null, lines: Map<string, number> }} ParsedYaml */

export class YamlSubsetError extends Error {
  /**
   * @param {string} message
   * @param {number} line 1-based line number
   */
  constructor(message, line) {
    super(`${message} (line ${line})`);
    this.name = 'YamlSubsetError';
    this.line = line;
  }
}

/**
 * @typedef {object} State
 * @property {string[]} raw
 * @property {number} i
 * @property {Map<string, number>} lines
 * @property {{ index: number, indent: number, text: string } | null} override
 */

/** @param {string} line */
const indentOf = (line) => line.length - line.trimStart().length;

/** @param {string} line */
const isBlank = (line) => {
  const t = line.trim();
  return t === '' || t.startsWith('#');
};

/** @param {string} text */
const isSeqItem = (text) => text === '-' || text.startsWith('- ');

/** Removes a trailing `# comment` that sits outside quotes and is preceded by whitespace (or starts the text). */
export function stripComment(/** @type {string} */ text) {
  /** @type {string | null} */
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charAt(i);
    if (quote !== null) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"') i += 1;
    } else if (c === '"' || c === "'") {
      if (i === 0 || /[\s[,:]/.test(text.charAt(i - 1))) quote = c;
    } else if (c === '#' && (i === 0 || /\s/.test(text.charAt(i - 1)))) {
      return text.slice(0, i).trimEnd();
    }
  }
  return text.trimEnd();
}

const PLAIN_KEY = /^([^\s'"{}[\],&*!|>%@`#-][^:#]*?|-[^\s:#][^:#]*?)\s*:(?:\s+(.*))?$/;
const QUOTED_KEY = /^(?:'((?:[^']|'')*)'|"((?:[^"\\]|\\.)*)")\s*:(?:\s+(.*))?$/;

/**
 * @param {string} text comment-stripped line text
 * @returns {{ key: string, rest: string } | null}
 */
function splitKey(text) {
  const quoted = QUOTED_KEY.exec(text);
  if (quoted) {
    const key = quoted[1] !== undefined ? quoted[1].replaceAll("''", "'") : String(JSON.parse(`"${quoted[2] ?? ''}"`));
    return { key, rest: (quoted[3] ?? '').trim() };
  }
  const plain = PLAIN_KEY.exec(text);
  if (!plain || plain[1] === undefined) return null;
  return { key: plain[1].trimEnd(), rest: (plain[2] ?? '').trim() };
}

/**
 * @param {string} text
 * @param {number} line
 * @returns {YamlNode}
 */
function parseScalar(text, line) {
  const t = stripComment(text).trim();
  if (t === '') return '';
  const first = t.charAt(0);
  if (first === '"') {
    if (t.length < 2 || !t.endsWith('"')) throw new YamlSubsetError('unterminated or multi-line double-quoted scalar', line);
    try {
      return String(JSON.parse(t));
    } catch {
      throw new YamlSubsetError('unsupported escape in double-quoted scalar', line);
    }
  }
  if (first === "'") {
    if (t.length < 2 || !t.endsWith("'")) throw new YamlSubsetError('unterminated or multi-line single-quoted scalar', line);
    const inner = t.slice(1, -1);
    if (/(^|[^'])'([^']|$)/.test(inner.replaceAll("''", ''))) throw new YamlSubsetError('stray quote in single-quoted scalar', line);
    return inner.replaceAll("''", "'");
  }
  if (first === '[') {
    if (!t.endsWith(']')) throw new YamlSubsetError('multi-line flow sequence', line);
    const body = t.slice(1, -1).trim();
    if (body === '') return [];
    if (/[[\]{}]/.test(body)) throw new YamlSubsetError('nested flow collection', line);
    return splitFlow(body, line).map((item) => {
      const value = parseScalar(item, line);
      if (typeof value !== 'string') throw new YamlSubsetError('nested flow collection', line);
      return value;
    });
  }
  if (first === '{') {
    if (t === '{}') return /** @type {YamlMap} */ (Object.create(null));
    throw new YamlSubsetError('flow mapping (only {} is supported)', line);
  }
  if ('&*!%@`'.includes(first)) throw new YamlSubsetError(`unsupported YAML construct "${first}"`, line);
  if (/:\s/.test(t) || t.endsWith(':')) throw new YamlSubsetError('plain scalar containing ": " (quote it or use a block scalar)', line);
  return t;
}

/**
 * Splits a flow sequence body on top-level commas (quotes respected).
 * @param {string} body
 * @param {number} line
 */
function splitFlow(body, line) {
  /** @type {string[]} */
  const items = [];
  let current = '';
  /** @type {string | null} */
  let quote = null;
  for (const c of body) {
    if (quote !== null) {
      if (c === quote) quote = null;
      current += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      current += c;
    } else if (c === ',') {
      items.push(current.trim());
      current = '';
    } else current += c;
  }
  if (quote !== null) throw new YamlSubsetError('unterminated quote in flow sequence', line);
  if (current.trim() !== '') items.push(current.trim());
  return items;
}

/**
 * @param {State} s
 * @returns {{ indent: number, text: string, lineNo: number } | null}
 */
function current(s) {
  while (s.i < s.raw.length) {
    if (s.override !== null && s.override.index === s.i) return { indent: s.override.indent, text: s.override.text, lineNo: s.i + 1 };
    const line = s.raw[s.i] ?? '';
    if (!isBlank(line)) return { indent: indentOf(line), text: stripComment(line.trim()), lineNo: s.i + 1 };
    s.i += 1;
  }
  return null;
}

/** @param {State} s */
function advance(s) {
  s.i += 1;
  s.override = null;
}

/**
 * @param {State} s
 * @param {number} parentIndent
 * @param {string} header `|`, `|-`, `>`, ...
 */
function parseBlockScalar(s, parentIndent, header) {
  /** @type {string[]} */
  const out = [];
  let contentIndent = -1;
  while (s.i < s.raw.length) {
    const line = s.raw[s.i] ?? '';
    if (line.trim() === '') {
      out.push('');
      s.i += 1;
      continue;
    }
    const ind = indentOf(line);
    if (ind <= parentIndent) break;
    if (contentIndent < 0) contentIndent = ind;
    if (ind < contentIndent) throw new YamlSubsetError('block scalar line indented less than its first line', s.i + 1);
    if (line.slice(0, contentIndent).includes('\t')) throw new YamlSubsetError('tab in block scalar indentation', s.i + 1);
    out.push(line.slice(contentIndent));
    s.i += 1;
  }
  s.override = null;
  if (contentIndent < 0 && out.every((l) => l === '')) {
    if (header.endsWith('+')) return '\n'.repeat(out.length);
    return '';
  }
  const trailing = [];
  while (out.length > 0 && out[out.length - 1] === '') trailing.push(out.pop());
  const body = header.startsWith('>') ? foldLines(out) : out.join('\n');
  if (header.endsWith('-')) return body;
  if (header.endsWith('+')) return `${body}\n${'\n'.repeat(trailing.length)}`;
  return `${body}\n`;
}

/** @param {string[]} lines */
function foldLines(lines) {
  let result = '';
  for (const [index, line] of lines.entries()) {
    if (index === 0) result = line;
    else if (line === '') result += '\n';
    else result += result.endsWith('\n') || /^\s/.test(line) ? line : ` ${line}`;
  }
  return result;
}

/**
 * @param {State} s
 * @param {string} rest value text after `key:` (comment-stripped)
 * @param {number} indent indent of the owning key
 * @param {string[]} path
 * @param {number} lineNo
 * @returns {YamlNode}
 */
function parseValue(s, rest, indent, path, lineNo) {
  if (/^[|>][-+]?$/.test(rest)) return parseBlockScalar(s, indent, rest);
  if (/^[|>]/.test(rest)) throw new YamlSubsetError('block scalar indentation indicators are not supported', lineNo);
  if (rest !== '') return parseScalar(rest, lineNo);
  const next = current(s);
  if (next !== null && next.indent > indent) return parseBlock(s, next.indent, path);
  if (next !== null && next.indent === indent && isSeqItem(next.text)) return parseSeq(s, indent, path);
  return '';
}

/**
 * @param {State} s
 * @param {number} indent
 * @param {string[]} path
 * @returns {YamlNode}
 */
function parseBlock(s, indent, path) {
  const line = current(s);
  if (line === null) return '';
  return isSeqItem(line.text) ? parseSeq(s, indent, path) : parseMap(s, indent, path);
}

/**
 * @param {State} s
 * @param {number} indent
 * @param {string[]} path
 * @returns {YamlMap}
 */
function parseMap(s, indent, path) {
  /** @type {YamlMap} */
  const map = Object.create(null);
  for (;;) {
    const line = current(s);
    if (line === null || line.indent < indent) break;
    if (line.indent > indent) throw new YamlSubsetError('unexpected indentation', line.lineNo);
    if (isSeqItem(line.text)) break;
    const pair = splitKey(line.text);
    if (pair === null) throw new YamlSubsetError(`expected "key: value", got "${line.text.slice(0, 40)}"`, line.lineNo);
    if (pair.key === '<<') throw new YamlSubsetError('merge keys are not supported', line.lineNo);
    if (Object.prototype.hasOwnProperty.call(map, pair.key)) throw new YamlSubsetError(`duplicate key "${pair.key}"`, line.lineNo);
    const childPath = [...path, pair.key];
    s.lines.set(childPath.join('.'), line.lineNo);
    advance(s);
    map[pair.key] = parseValue(s, pair.rest, indent, childPath, line.lineNo);
  }
  return map;
}

/**
 * @param {State} s
 * @param {number} indent
 * @param {string[]} path
 * @returns {YamlSeq}
 */
function parseSeq(s, indent, path) {
  /** @type {YamlSeq} */
  const seq = [];
  for (;;) {
    const line = current(s);
    if (line === null || line.indent < indent) break;
    if (line.indent > indent) throw new YamlSubsetError('unexpected indentation in sequence', line.lineNo);
    if (!isSeqItem(line.text)) break;
    const itemPath = [...path, String(seq.length)];
    s.lines.set(itemPath.join('.'), line.lineNo);
    const after = line.text === '-' ? '' : line.text.slice(2);
    const body = after.trimStart();
    const col = indent + 2 + (after.length - body.length);
    if (body === '') {
      advance(s);
      const next = current(s);
      seq.push(next !== null && next.indent > indent ? parseBlock(s, next.indent, itemPath) : '');
    } else if (isSeqItem(body)) {
      throw new YamlSubsetError('nested inline sequences are not supported', line.lineNo);
    } else if (splitKey(body) !== null) {
      s.override = { index: s.i, indent: col, text: body };
      seq.push(parseMap(s, col, itemPath));
    } else {
      advance(s);
      seq.push(/^[|>]/.test(body) ? parseValue(s, body, indent, itemPath, line.lineNo) : parseScalar(body, line.lineNo));
    }
  }
  return seq;
}

/**
 * Characters the line splitter (`\r?\n`) does not treat as line breaks but a YAML 1.1 parser may (lone CR, NEL, LS,
 * PS), other C0 controls, and a byte-order mark after the first character. Any of them could hide the rest of a
 * comment line from this parser while GitHub's parser reads it as a new line (code review m1), so they fail closed.
 * TAB is allowed (it is rejected separately in indentation); CR only as part of CRLF, which the splitter consumes.
 */
// eslint-disable-next-line no-control-regex -- TASK-007 the control characters are what this pattern detects
const FORBIDDEN_CHAR = /[\u0000-\u0008\u000B-\u001F\u0085\u2028\u2029\uFEFF]/;

const FORBIDDEN_NAMES = new Map([
  ['\r', 'a carriage return not followed by a line feed (U+000D)'],
  ['\u0085', 'NEXT LINE (U+0085)'],
  ['\u2028', 'LINE SEPARATOR (U+2028)'],
  ['\u2029', 'PARAGRAPH SEPARATOR (U+2029)'],
  ['\uFEFF', 'a byte-order mark (U+FEFF) after the first character'],
]);

/** @param {string} char */
const describeForbidden = (char) =>
  FORBIDDEN_NAMES.get(char) ?? `control character U+${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`;

/**
 * Parses `text` (one YAML document in the supported subset). Fails closed on the characters in `FORBIDDEN_CHAR`.
 * @param {string} text
 * @returns {ParsedYaml}
 * @throws {YamlSubsetError}
 */
export function parseYamlSubset(text) {
  const raw = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/);
  for (const [index, line] of raw.entries()) {
    const forbidden = FORBIDDEN_CHAR.exec(line);
    if (forbidden !== null) throw new YamlSubsetError(`${describeForbidden(forbidden[0])} is not allowed`, index + 1);
    if (/^\s*\t/.test(line) && !isBlank(line)) throw new YamlSubsetError('tab in indentation', index + 1);
    if (/^(---|\.\.\.)(\s|$)/.test(line)) throw new YamlSubsetError('document markers are not supported', index + 1);
    if (/^%/.test(line)) throw new YamlSubsetError('directives are not supported', index + 1);
  }
  /** @type {State} */
  const s = { raw, i: 0, lines: new Map(), override: null };
  const first = current(s);
  if (first === null) return { value: null, lines: s.lines };
  if (first.indent !== 0) throw new YamlSubsetError('document must start at column 0', first.lineNo);
  const value = parseBlock(s, 0, []);
  const leftover = current(s);
  if (leftover !== null) throw new YamlSubsetError('unexpected content after the document', leftover.lineNo);
  return { value, lines: s.lines };
}

/**
 * @param {YamlNode | null | undefined} node
 * @returns {node is YamlMap}
 */
export const isMap = (node) => typeof node === 'object' && node !== null && !Array.isArray(node);

/**
 * Every string scalar below `node` (map keys excluded), depth first.
 * @param {YamlNode | null | undefined} node
 * @returns {string[]}
 */
export function deepStrings(node) {
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap((child) => deepStrings(child));
  if (isMap(node)) return Object.values(node).flatMap((child) => deepStrings(child));
  return [];
}
