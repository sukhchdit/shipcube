// @ts-check
/**
 * Strict, dependency-free JUnit XML reader for lane B evidence (TEST-STRATEGY section 9.2 rule 1; ADR-0023 amendment G
 * item 1). It accepts `<testsuites>` with `<testsuite>` children, a bare `<testsuite>` root, and what
 * `lib/junit-write.mjs` produces.
 *
 * XXE-safe by construction: a document with a DOCTYPE or ENTITY declaration is rejected before any parsing, only the
 * five predefined entities and numeric character references are decoded, and nothing is ever fetched or expanded.
 * Input size is bounded. The scanner is a single forward pass over the text with `indexOf`, so its cost is linear.
 *
 * Counting: one status per `<testcase>` (error over failure over skipped over passed). When a `<testsuite>` or
 * `<testsuites>` element declares `tests`, `failures`, `errors` or `skipped`, the declared value must equal the count of
 * its test cases; a mismatch throws (an edited attribute cannot hide a failing case).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** Upper bound for one JUnit file (the whole run directory is capped at 5 MB, ADR-0023 amendment B). */
export const MAX_JUNIT_BYTES = 5 * 1024 * 1024;
const MAX_CASES = 200_000;
const MAX_DEPTH = 64;

/**
 * @typedef {'passed' | 'failed' | 'error' | 'skipped'} CaseStatus
 * @typedef {{ name: string, classname: string, status: CaseStatus, time: number }} JUnitCase
 * @typedef {{ tests: number, failures: number, errors: number, skipped: number, time: number, cases: JUnitCase[] }} JUnitReport
 */

export class JUnitError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'JUnitError';
  }
}

const NAMED_ENTITIES = /** @type {Record<string, string>} */ ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" });

/**
 * Decodes the five predefined XML entities and numeric character references; anything else throws.
 * @param {string} text
 */
export function decodeEntities(text) {
  let out = '';
  let index = 0;
  for (;;) {
    const amp = text.indexOf('&', index);
    if (amp === -1) return out + text.slice(index);
    const semi = text.indexOf(';', amp);
    if (semi === -1 || semi - amp > 10) throw new JUnitError(`unterminated entity reference near offset ${amp}`);
    const ref = text.slice(amp + 1, semi);
    out += text.slice(index, amp);
    if (Object.hasOwn(NAMED_ENTITIES, ref)) out += NAMED_ENTITIES[ref];
    else if (/^#[0-9]{1,7}$/.test(ref) || /^#x[0-9A-Fa-f]{1,6}$/.test(ref)) {
      const code = ref[1] === 'x' ? Number.parseInt(ref.slice(2), 16) : Number.parseInt(ref.slice(1), 10);
      if (code > 0x10ffff) throw new JUnitError(`character reference out of range: &${ref};`);
      out += String.fromCodePoint(code);
    } else throw new JUnitError(`unsupported entity &${ref}; (only the predefined XML entities are accepted)`);
    index = semi + 1;
  }
}

/**
 * Parses the attributes of a start tag body (the text after the element name, without `/>` or `>`).
 * @param {string} body
 * @returns {Map<string, string>}
 */
function parseAttributes(body) {
  /** @type {Map<string, string>} */
  const attributes = new Map();
  let i = 0;
  const isSpace = (/** @type {string | undefined} */ c) => c === ' ' || c === '\t' || c === '\n' || c === '\r';
  while (i < body.length) {
    while (isSpace(body[i])) i += 1;
    if (i >= body.length) break;
    const eq = body.indexOf('=', i);
    if (eq === -1) throw new JUnitError(`malformed attribute list: ${body.slice(i, i + 40)}`);
    const name = body.slice(i, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name)) throw new JUnitError(`malformed attribute name ${JSON.stringify(name.slice(0, 40))}`);
    let q = eq + 1;
    while (isSpace(body[q])) q += 1;
    const quote = body[q];
    if (quote !== '"' && quote !== "'") throw new JUnitError(`attribute ${name} is not quoted`);
    const end = body.indexOf(quote, q + 1);
    if (end === -1) throw new JUnitError(`attribute ${name} is not terminated`);
    const raw = body.slice(q + 1, end);
    if (raw.includes('<')) throw new JUnitError(`attribute ${name} contains '<'`);
    if (attributes.has(name)) throw new JUnitError(`duplicate attribute ${name}`);
    attributes.set(name, decodeEntities(raw));
    i = end + 1;
  }
  return attributes;
}

/**
 * @param {Map<string, string>} attributes
 * @param {string} name
 * @returns {number | undefined}
 */
function intAttribute(attributes, name) {
  const value = attributes.get(name);
  if (value === undefined) return undefined;
  if (!/^[0-9]{1,9}$/.test(value)) throw new JUnitError(`attribute ${name}="${value.slice(0, 20)}" is not a non-negative integer`);
  return Number(value);
}

/**
 * @param {Map<string, string>} attributes
 * @returns {number}
 */
function timeAttribute(attributes) {
  const value = attributes.get('time');
  if (value === undefined || value === '') return 0;
  const time = Number(value.replaceAll(',', ''));
  if (!Number.isFinite(time) || time < 0) throw new JUnitError(`attribute time="${value.slice(0, 20)}" is not a duration`);
  return time;
}

/**
 * @typedef {{ name: string, attributes: Map<string, string>, counts: { tests: number, failures: number, errors: number, skipped: number }, current?: JUnitCase }} Frame
 */

/**
 * @param {Frame} frame
 */
function checkDeclaredCounts(frame) {
  for (const key of /** @type {const} */ (['tests', 'failures', 'errors', 'skipped'])) {
    const declared = intAttribute(frame.attributes, key);
    if (declared !== undefined && declared !== frame.counts[key])
      throw new JUnitError(
        `<${frame.name}${frame.attributes.has('name') ? ` name="${String(frame.attributes.get('name')).slice(0, 80)}"` : ''}> declares ${key}="${declared}" but contains ${frame.counts[key]}`,
      );
  }
}

/** @type {Record<CaseStatus, number>} */
const STATUS_RANK = { passed: 0, skipped: 1, failed: 2, error: 3 };

/**
 * Parses a JUnit XML document.
 * @param {string} xml
 * @returns {JUnitReport}
 */
export function parseJUnit(xml) {
  if (typeof xml !== 'string') throw new JUnitError('JUnit input must be a string');
  if (Buffer.byteLength(xml, 'utf8') > MAX_JUNIT_BYTES) throw new JUnitError(`JUnit file exceeds ${MAX_JUNIT_BYTES} bytes`);
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) throw new JUnitError('DOCTYPE/ENTITY declarations are not accepted');
  /** @type {JUnitCase[]} */
  const cases = [];
  /** @type {Frame[]} */
  const stack = [];
  let rootName = '';
  let rootClosed = false;
  let index = xml.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (;;) {
    const lt = xml.indexOf('<', index);
    const text = xml.slice(index, lt === -1 ? xml.length : lt);
    if ((stack.length === 0 || rootClosed) && text.trim() !== '') throw new JUnitError('text outside the root element');
    if (stack.length > 0) decodeEntities(text);
    if (lt === -1) break;
    if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt + 2);
      if (end === -1 || rootName !== '') throw new JUnitError('malformed processing instruction');
      index = end + 2;
      continue;
    }
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      if (end === -1) throw new JUnitError('unterminated comment');
      index = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      if (stack.length === 0) throw new JUnitError('CDATA outside the root element');
      const end = xml.indexOf(']]>', lt + 9);
      if (end === -1) throw new JUnitError('unterminated CDATA section');
      index = end + 3;
      continue;
    }
    if (xml[lt + 1] === '!') throw new JUnitError('markup declarations are not accepted');
    const gt = xml.indexOf('>', lt + 1);
    if (gt === -1) throw new JUnitError('unterminated tag');
    let tag = xml.slice(lt + 1, gt);
    index = gt + 1;
    if (tag.startsWith('/')) {
      const name = tag.slice(1).trim();
      const frame = stack.pop();
      if (frame === undefined || frame.name !== name) throw new JUnitError(`unexpected closing tag </${name}>`);
      closeElement(frame);
      continue;
    }
    const selfClosing = tag.endsWith('/');
    if (selfClosing) tag = tag.slice(0, -1);
    const nameEnd = tag.search(/[\s]/);
    const name = nameEnd === -1 ? tag : tag.slice(0, nameEnd);
    if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name)) throw new JUnitError(`malformed element name ${JSON.stringify(name.slice(0, 40))}`);
    const attributes = parseAttributes(nameEnd === -1 ? '' : tag.slice(nameEnd));
    if (stack.length === 0) {
      if (rootName !== '') throw new JUnitError('more than one root element');
      if (name !== 'testsuites' && name !== 'testsuite') throw new JUnitError(`root element <${name}> is not <testsuites> or <testsuite>`);
      rootName = name;
    }
    if (stack.length >= MAX_DEPTH) throw new JUnitError('element nesting too deep');
    /** @type {Frame} */
    const frame = { name, attributes, counts: { tests: 0, failures: 0, errors: 0, skipped: 0 } };
    openElement(frame);
    if (selfClosing) closeElement(frame);
    else stack.push(frame);
  }
  if (stack.length > 0) throw new JUnitError(`unclosed element <${String(stack.at(-1)?.name)}>`);
  if (rootName === '') throw new JUnitError('no <testsuites> or <testsuite> root element');

  /** @param {Frame} frame */
  function openElement(frame) {
    const parent = stack.at(-1);
    if (frame.name === 'testcase') {
      if (parent === undefined || parent.name !== 'testsuite') throw new JUnitError('<testcase> outside a <testsuite>');
      if (cases.length >= MAX_CASES) throw new JUnitError(`more than ${MAX_CASES} test cases`);
      frame.current = {
        name: frame.attributes.get('name') ?? '',
        classname: frame.attributes.get('classname') ?? '',
        status: 'passed',
        time: timeAttribute(frame.attributes),
      };
      return;
    }
    if (frame.name === 'testsuite' && parent !== undefined && parent.name !== 'testsuites' && parent.name !== 'testsuite')
      throw new JUnitError(`<testsuite> inside <${parent.name}>`);
    if (frame.name === 'testsuites' && parent !== undefined) throw new JUnitError('nested <testsuites>');
    if (parent?.name === 'testcase' && parent.current !== undefined) {
      /** @type {CaseStatus | undefined} */
      const status =
        frame.name === 'failure' ? 'failed' : frame.name === 'error' ? 'error' : frame.name === 'skipped' ? 'skipped' : undefined;
      if (status !== undefined && STATUS_RANK[status] > STATUS_RANK[parent.current.status]) parent.current.status = status;
    }
  }

  /** @param {Frame} frame */
  function closeElement(frame) {
    const parent = stack.at(-1);
    if (frame.name === 'testcase' && frame.current !== undefined) {
      const kase = frame.current;
      cases.push(kase);
      if (parent !== undefined) {
        parent.counts.tests += 1;
        if (kase.status === 'failed') parent.counts.failures += 1;
        else if (kase.status === 'error') parent.counts.errors += 1;
        else if (kase.status === 'skipped') parent.counts.skipped += 1;
      }
      return;
    }
    if (frame.name === 'testsuite' || frame.name === 'testsuites') {
      checkDeclaredCounts(frame);
      if (parent !== undefined)
        for (const key of /** @type {const} */ (['tests', 'failures', 'errors', 'skipped'])) parent.counts[key] += frame.counts[key];
    }
    if (stack.length === 0) rootClosed = true;
  }

  return {
    tests: cases.length,
    failures: cases.filter((c) => c.status === 'failed').length,
    errors: cases.filter((c) => c.status === 'error').length,
    skipped: cases.filter((c) => c.status === 'skipped').length,
    time: Math.round(cases.reduce((sum, c) => sum + c.time, 0) * 1000) / 1000,
    cases,
  };
}

/**
 * SHA-256 (hex) of a file's bytes.
 * @param {string} path
 */
export function sha256File(path) {
  return sha256Bytes(readFileSync(path));
}

/**
 * @param {Uint8Array | string} bytes
 */
export function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
