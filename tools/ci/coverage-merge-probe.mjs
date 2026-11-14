// @ts-check
/**
 * Real-Jest differential probe for the cross-run coverage merge (PR #40 code review R1-M1; PR40-SEC-06). Each trial
 * writes a small module plus test files to a temporary project, runs the repository's Jest three times with
 * `coverageProvider: 'v8'` (run A = A's test files, run B = B's test files, combined = all of them in ONE run) and keeps
 * the module's three istanbul entries. tools/ci/coverage-merge.test.ts replays the committed trials: the merge of A and
 * B must have exactly the combined run's lines and never a higher branch percentage.
 *
 * The trials are generated from a seed (deterministic sources and calls; Jest's output is deterministic for a given Jest,
 * v8-to-istanbul and @swc/jest version). Half of the random trials are TypeScript compiled by @swc/jest with the
 * repository's SWC_JEST_OPTIONS (source-mapped positions), half plain JavaScript. Two fixed trials reproduce the
 * review's probe. Paths in the fixture are `/probe/...`, never a host path.
 *
 * Re-run after a Jest, v8-to-istanbul, @swc/jest or transform change (PR40-SEC-06):
 *   node tools/ci/coverage-merge-probe.mjs [--seed 40] [--trials 30] [--out tools/ci/fixtures/coverage-merge/trials.json]
 *   node tools/ci/coverage-merge-probe.mjs --report tools/ci/fixtures/coverage-merge/trials.json
 * Exit 0 written / every trial within the bound, 1 a trial above the combined run, 2 usage or Jest failure.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { mergeCoverageMaps, summarizeFile } from './coverage-merge.mjs';

/** @typedef {import('./coverage-merge.mjs').FileCoverage} FileCoverage */
/**
 * Compact entry: s = [line, length, count] per line; f = [name, sl, sc, el, ec, count]; b = [sl, sc, el, ec, count].
 * @typedef {{ s: number[][], f: Array<[string, number, number, number, number, number]>, b: number[][] }} CompactEntry
 * @typedef {{ name: string, lang: 'js' | 'ts', source: string, tests: { A: string[], B: string[] },
 *   A: CompactEntry, B: CompactEntry, combined: CompactEntry }} Trial
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PROBE_PATH = { js: '/probe/src/m.js', ts: '/probe/src/m.ts' };

/** Deterministic PRNG (mulberry32). @param {number} seed */
export function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** @param {FileCoverage} fc @returns {CompactEntry} */
export function compact(fc) {
  return {
    s: Object.entries(fc.statementMap).map(([id, l]) => [l.start.line, Number(l.end.column), fc.s[id] ?? 0]),
    f: Object.entries(fc.fnMap).map(([id, m]) => [
      m.name,
      m.loc.start.line,
      Number(m.loc.start.column),
      m.loc.end.line,
      Number(m.loc.end.column),
      fc.f[id] ?? 0,
    ]),
    b: Object.entries(fc.branchMap).map(([id, m]) => [
      m.loc.start.line,
      Number(m.loc.start.column),
      m.loc.end.line,
      Number(m.loc.end.column),
      fc.b[id]?.[0] ?? 0,
    ]),
  };
}

/** v8-to-istanbul shape of a compact entry. @param {CompactEntry} c @param {string} path @returns {FileCoverage} */
export function expand(c, path) {
  /** @type {FileCoverage} */
  const fc = { path, statementMap: {}, s: {}, fnMap: {}, f: {}, branchMap: {}, b: {} };
  c.s.forEach(([line, length, count], i) => {
    fc.statementMap[String(i)] = { start: { line: Number(line), column: 0 }, end: { line: Number(line), column: Number(length) } };
    fc.s[String(i)] = Number(count);
  });
  c.f.forEach(([name, sl, sc, el, ec, count], i) => {
    const loc = { start: { line: sl, column: sc }, end: { line: el, column: ec } };
    fc.fnMap[String(i)] = { name, decl: loc, loc: { start: { ...loc.start }, end: { ...loc.end } }, line: sl };
    fc.f[String(i)] = count;
  });
  c.b.forEach(([sl, sc, el, ec, count], i) => {
    const loc = { start: { line: Number(sl), column: Number(sc) }, end: { line: Number(el), column: Number(ec) } };
    fc.branchMap[String(i)] = { type: 'branch', line: Number(sl), loc, locations: [{ start: { ...loc.start }, end: { ...loc.end } }] };
    fc.b[String(i)] = [Number(count)];
  });
  return fc;
}

// --- random module and calls ---------------------------------------------------------------------------------------

/**
 * One random module: 3-5 exported functions over (a, b, c, xs), built from statements that make V8 coalesce and elide
 * ranges (early returns, if/else chains, loops with break/continue, switch fall-through, try/catch, ternaries, logical
 * operators) and from anonymous callbacks that a run may never call (single-line and multi-line, with inner branches).
 * @param {() => number} rnd
 * @param {'js' | 'ts'} lang
 * @returns {{ source: string, names: string[] }}
 */
export function randomModule(rnd, lang) {
  const ri = (/** @type {number} */ n) => Math.floor(rnd() * n);
  const pick = (/** @type {readonly string[]} */ xs) => /** @type {string} */ (xs[ri(xs.length)]);
  const ts = lang === 'ts';
  const num = ts ? ': number' : '';
  const arr = ts ? ': number[]' : '';
  let inner = 0;
  /** @param {number} depth @param {string[]} vars @param {string} pad @returns {string[]} */
  const statement = (depth, vars, pad) => {
    const v = () => pick(vars);
    const k = () => String(ri(4));
    const nested = () => (depth < 2 ? block(depth + 1, vars, `${pad}  `, 1 + ri(2)) : [`${pad}  acc += ${k()};`]);
    switch (ri(depth < 2 ? 15 : 10)) {
      case 0:
        return [`${pad}if (${v()} === ${k()}) {`, `${pad}  return acc + ${k()};`, `${pad}}`];
      case 1:
        return [`${pad}if (${v()} > ${k()}) acc += ${k()};`];
      case 2:
        return [`${pad}if (${v()} < ${k()}) return acc;`];
      case 3:
        return [`${pad}acc += ${v()} > ${k()} ? 1 : ${v()} > ${k()} ? 2 : 3;`];
      case 4:
        return [`${pad}acc += (${v()} && ${v()}) || ${v()} ? 1 : 0;`];
      case 5:
        return [`${pad}acc += xs.filter((x${num}) => x > ${k()}).length;`];
      case 6:
        return [`${pad}acc += xs.map((x${num}) => (x > ${k()} ? 1 : 2)).reduce((p${num}, q${num}) => p + q, 0);`];
      case 7:
        return [
          `${pad}for (let i = 0; i < ${v()}; i += 1) {`,
          `${pad}  if (i === ${k()}) {`,
          `${pad}    ${pick(['continue', 'break'])};`,
          `${pad}  }`,
          `${pad}  acc += i;`,
          `${pad}}`,
        ];
      case 8:
        return [
          `${pad}switch (${v()} % 3) {`,
          `${pad}  case 0:`,
          `${pad}    acc += 1;`,
          `${pad}  case 1:`,
          `${pad}    acc += 2;`,
          `${pad}    break;`,
          `${pad}  default:`,
          `${pad}    acc -= 1;`,
          `${pad}}`,
        ];
      case 9:
        return [
          `${pad}try {`,
          `${pad}  if (${v()} > ${k()}) {`,
          `${pad}    throw new Error('x');`,
          `${pad}  }`,
          `${pad}  acc += 1;`,
          `${pad}} catch {`,
          `${pad}  acc -= 1;`,
          `${pad}}`,
        ];
      case 10:
        return [`${pad}if (${v()} > ${k()}) {`, ...nested(), ...(rnd() < 0.5 ? [`${pad}} else {`, ...nested()] : []), `${pad}}`];
      case 11:
        return [`${pad}xs.forEach((x${num}) => {`, ...block(depth + 1, [...vars, 'x'], `${pad}  `, 1 + ri(2)), `${pad}});`];
      case 12: {
        inner += 1;
        return [
          `${pad}const inner${inner} = (y${num})${num} => (y > ${k()} ? y : -y);`,
          `${pad}acc += ${v()} > ${k()} ? inner${inner}(${v()}) : 0;`,
        ];
      }
      case 13:
        return [
          `${pad}acc += (() => {`,
          `${pad}  if (${v()} > ${k()}) {`,
          `${pad}    return 1;`,
          `${pad}  }`,
          `${pad}  return 2;`,
          `${pad}})();`,
        ];
      default:
        return [`${pad}if (xs.some((x${num}) => x === ${k()})) {`, ...nested(), `${pad}}`];
    }
  };
  /** @param {number} depth @param {string[]} vars @param {string} pad @param {number} n @returns {string[]} */
  const block = (depth, vars, pad, n) => Array.from({ length: n }, () => statement(depth, vars, pad)).flat();
  const names = Array.from({ length: 3 + ri(3) }, (_, i) => `f${i}`);
  /** @type {string[]} */
  const out = [];
  for (const name of names) {
    const params = ts ? `a${num}, b${num}, c${num}, xs${arr}` : 'a, b, c, xs';
    const body = ['  let acc = 0;', ...block(0, ['a', 'b', 'c'], '  ', 1 + ri(4)), '  return acc;'];
    const exp = ts ? 'export ' : '';
    if (rnd() < 0.5) out.push(`${exp}function ${name}(${params})${num} {`, ...body, '}');
    else out.push(`${exp}const ${name} = (${params})${num} => {`, ...body, '};');
  }
  if (!ts) out.push(`module.exports = { ${names.join(', ')} };`);
  return { source: `${out.join('\n')}\n`, names };
}

/** @param {() => number} rnd @param {string[]} names @param {'js' | 'ts'} lang */
function randomTest(rnd, names, lang) {
  const ri = (/** @type {number} */ n) => Math.floor(rnd() * n);
  const calls = Array.from({ length: 1 + ri(4) }, () => {
    const xs = Array.from({ length: ri(4) }, () => ri(4));
    return `  m.${names[ri(names.length)]}(${ri(4)}, ${ri(4)}, ${ri(4)}, [${xs.join(', ')}]);`;
  });
  return [`const m = require('../src/m${lang === 'ts' ? '' : '.js'}');`, "test('probe', () => {", ...calls, '});', ''].join('\n');
}

// --- running Jest --------------------------------------------------------------------------------------------------

/**
 * Runs the three Jest runs of one trial and returns the module's compact entries.
 * @param {{ lang: 'js' | 'ts', source: string, tests: { A: string[], B: string[] } }} spec
 * @param {Record<string, unknown>} swcOptions
 * @returns {{ A: CompactEntry, B: CompactEntry, combined: CompactEntry }}
 */
export function runTrial(spec, swcOptions) {
  const dir = mkdtempSync(join(tmpdir(), 'covprobe-'));
  try {
    mkdirSync(join(dir, 'src'));
    mkdirSync(join(dir, 'tests'));
    writeFileSync(join(dir, 'src', `m.${spec.lang}`), spec.source);
    /** @type {Record<string, string[]>} */
    const files = { A: [], B: [] };
    for (const run of /** @type {const} */ (['A', 'B']))
      spec.tests[run].forEach((text, i) => {
        const file = `tests/${run.toLowerCase()}${i}.test.js`;
        writeFileSync(join(dir, file), text);
        files[run]?.push(file);
      });
    const config = {
      rootDir: dir,
      testMatch: ['<rootDir>/tests/**/*.test.js'],
      transform: spec.lang === 'ts' ? { '^.+\\.(t|j)sx?$': [join(REPO, 'node_modules', '@swc', 'jest'), swcOptions] } : {},
      coverageProvider: 'v8',
      collectCoverageFrom: ['src/**/*.{js,ts}'],
      coverageReporters: ['json'],
      testEnvironment: 'node',
    };
    writeFileSync(join(dir, 'jest.config.json'), JSON.stringify(config));
    /** @param {string} name @param {string[]} tests */
    const run = (name, tests) => {
      const out = join(dir, `cov-${name}`);
      const r = spawnSync(
        process.execPath,
        [
          join(REPO, 'node_modules', 'jest', 'bin', 'jest.js'),
          '--config',
          join(dir, 'jest.config.json'),
          '-i',
          '--no-cache',
          '--coverage',
          `--coverageDirectory=${out}`,
          '--runTestsByPath',
          ...tests,
        ],
        { cwd: dir, encoding: 'utf8', windowsHide: true },
      );
      if (r.status !== 0) throw new Error(`jest run ${name} failed (exit ${String(r.status)})`);
      const map = /** @type {Record<string, FileCoverage>} */ (JSON.parse(readFileSync(join(out, 'coverage-final.json'), 'utf8')));
      const entry = Object.values(map)[0];
      if (entry === undefined || Object.keys(map).length !== 1) throw new Error(`jest run ${name}: expected one file`);
      return compact(entry);
    };
    return {
      A: run('A', files['A'] ?? []),
      B: run('B', files['B'] ?? []),
      combined: run('combined', [...(files['A'] ?? []), ...(files['B'] ?? [])]),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The review's probe (PR #40 code review, R1-M1 detail): `g(1,0); h(0); m()` against `g(0,1); h(0)`. */
const REVIEW_SOURCE = [
  'function g(z, a) {',
  '  if (z) {',
  '    return -1;',
  '  }',
  '  if (a) {',
  '    return 0;',
  '  }',
  '  return 2;',
  '}',
  'function h(x) {',
  '  if (x) {',
  '    return 1;',
  '  }',
  '  return 0;',
  '}',
  'function m() {',
  '  return 3;',
  '}',
  'module.exports = { g, h, m };',
  '',
].join('\n');

/** @returns {Array<{ name: string, lang: 'js' | 'ts', source: string, tests: { A: string[], B: string[] } }>} */
function fixedTrials() {
  const t = (/** @type {string} */ calls) => `const { g, h, m } = require('../src/m.js');\ntest('probe', () => {\n  ${calls}\n});\n`;
  return [
    {
      name: 'review g(1,0) h(0) m() vs g(0,1) h(0)',
      lang: 'js',
      source: REVIEW_SOURCE,
      tests: { A: [t('g(1, 0); h(0); m();')], B: [t('g(0, 1); h(0);')] },
    },
    { name: 'review g alone: g(1,0) vs g(0,1)', lang: 'js', source: REVIEW_SOURCE, tests: { A: [t('g(1, 0);')], B: [t('g(0, 1);')] } },
  ];
}

/**
 * @param {number} seed
 * @param {number} count random trials
 * @returns {Array<{ name: string, lang: 'js' | 'ts', source: string, tests: { A: string[], B: string[] } }>}
 */
export function trialSpecs(seed, count) {
  const rnd = prng(seed);
  return [
    ...fixedTrials(),
    ...Array.from({ length: count }, (_, i) => {
      const lang = /** @type {'js' | 'ts'} */ (i % 2 === 0 ? 'js' : 'ts');
      const { source, names } = randomModule(rnd, lang);
      const tests = {
        A: Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => randomTest(rnd, names, lang)),
        B: Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => randomTest(rnd, names, lang)),
      };
      return { name: `seed ${seed} trial ${i} (${lang})`, lang, source, tests };
    }),
  ];
}

/**
 * Merged versus combined for one trial (the bound the merge guarantees: lines equal, branch percentage not above).
 * @param {Trial} trial
 */
export function compareTrial(trial) {
  const path = PROBE_PATH[trial.lang];
  const merged = mergeCoverageMaps([{ [path]: expand(trial.A, path) }, { [path]: expand(trial.B, path) }])[path];
  const m = summarizeFile(/** @type {FileCoverage} */ (merged));
  const c = summarizeFile(expand(trial.combined, path));
  return {
    merged: m,
    combined: c,
    linesEqual: m.lines.covered === c.lines.covered && m.lines.total === c.lines.total,
    branchesNotAbove: m.branches.pct <= c.branches.pct,
  };
}

/** @param {string[]} argv @returns {Promise<number>} */
export async function main(argv) {
  let seed = 40;
  let trials = 30;
  let out = 'tools/ci/fixtures/coverage-merge/trials.json';
  /** @type {string | null} */
  let report = null;
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (value === undefined) return usage();
    if (flag === '--seed' && /^\d{1,9}$/.test(value)) seed = Number(value);
    else if (flag === '--trials' && /^\d{1,3}$/.test(value)) trials = Number(value);
    else if (flag === '--out') out = value;
    else if (flag === '--report') report = value;
    else return usage();
  }
  if (report !== null) {
    const data = /** @type {{ trials: Trial[] }} */ (JSON.parse(readFileSync(resolve(report), 'utf8')));
    let above = 0;
    for (const trial of data.trials) {
      const r = compareTrial(trial);
      const fmt = (/** @type {{ covered: number, total: number, pct: number }} */ x) => `${x.covered}/${x.total} (${x.pct}%)`;
      const verdict =
        r.linesEqual && r.branchesNotAbove ? (r.merged.branches.pct === r.combined.branches.pct ? 'equal' : 'below') : 'ABOVE';
      if (verdict === 'ABOVE') above += 1;
      console.log(
        `${verdict.padEnd(5)} ${trial.name}: branches merged ${fmt(r.merged.branches)} combined ${fmt(r.combined.branches)}; lines ${fmt(r.merged.lines)} vs ${fmt(r.combined.lines)}`,
      );
    }
    return above === 0 ? 0 : 1;
  }
  const { SWC_JEST_OPTIONS } = /** @type {{ SWC_JEST_OPTIONS: Record<string, unknown> }} */ (
    await import(pathToFileURL(join(REPO, 'jest.config.ts')).href)
  );
  /** @type {Trial[]} */
  const results = [];
  for (const spec of trialSpecs(seed, trials)) {
    console.error(`coverage-merge-probe: ${spec.name}`);
    results.push({ ...spec, ...runTrial(spec, SWC_JEST_OPTIONS) });
  }
  const target = resolve(out);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(
    target,
    `${JSON.stringify({ generator: 'tools/ci/coverage-merge-probe.mjs', seed, random_trials: trials, trials: results })}\n`,
  );
  // The repository's Prettier layout, so a regenerated fixture passes `npm run format:check` as written.
  const formatted = spawnSync(process.execPath, [join(REPO, 'node_modules', 'prettier', 'bin', 'prettier.cjs'), '--write', target], {
    cwd: REPO,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (formatted.status !== 0) throw new Error(`prettier --write failed (exit ${String(formatted.status)})`);
  console.error(`coverage-merge-probe: ${results.length} trials written to ${out}`);
  return 0;
}

function usage() {
  console.error('usage: node tools/ci/coverage-merge-probe.mjs [--seed <n>] [--trials <n>] [--out <file>] | --report <file>');
  return 2;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`coverage-merge-probe: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 2;
    },
  );
}
