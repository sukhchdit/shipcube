/**
 * The in-house `User-Agent` parser for `audit_entries.ua_parsed` (data-model §3.4: browser family + major version / OS
 * family only, at most 120 characters, INT; ADR-0007 amendment 2; D-ARCH-141, owner TASK-028). Dependency-free:
 * `ua-parser-js` 2.x is AGPL-3.0-or-later, outside LICENSE_ALLOWLIST.
 *
 * Safety properties (D-SEC-PR53-02, PR42-SEC-04):
 *  - Only the first {@link MAX_USER_AGENT_SCAN} characters are read; the raw header is PERSONAL and reaches the entry
 *    only as a vault token.
 *  - One pass, no regular expression: every character is visited once and every word is classified once by an exact
 *    lookup in a closed table. {@link scanUserAgent} counts one step per character visited plus, per word, one step and
 *    one per character the classification reads (its `indexOf` / `slice` work), so a super-linear classification would
 *    move the count; the work is at most 3 x 512 steps and the unit test asserts literal counts for adversarial inputs.
 *  - The output is assembled from the closed family tables and ASCII digits only: no character of the header other
 *    than the major version's digits can reach the INT column, so a crafted header cannot place free text there.
 *
 * Words are separated by space, `;`, `,`, `(` and `)`. A word `Name/Version` outside or inside a comment is a product
 * token; a word inside a parenthesised comment is also an OS marker. The browser is the highest-ranked product found
 * (Edge, Opera and Samsung Internet carry a `Chrome` token too; Chrome carries `Safari`), the OS the highest-ranked
 * marker (Android carries `Linux`, iOS carries `Mac OS X`). Safari counts only with its `Version/` token: every
 * WebKit or Blink client carries `Safari/`, so without it an unlisted client (`HeadlessChrome`) would be guessed as
 * Safari (PR #61 dup-review R1-m7). An unknown client is `null`, never a guess.
 */

/** Characters of the header the parser reads. */
export const MAX_USER_AGENT_SCAN = 512;
/** Digits of a major version kept (a longer run is not a version). */
const MAX_MAJOR_DIGITS = 4;

interface Product {
  readonly family: string;
  /** Lower ranks win. */
  readonly rank: number;
  /** Safari reports its version in the `Version/` token, not in `Safari/`. */
  readonly versionFromVersionToken?: boolean;
}

const product = (family: string, rank: number, versionFromVersionToken = false): Product =>
  Object.freeze({ family, rank, ...(versionFromVersionToken ? { versionFromVersionToken } : {}) });

/** Product token name -> browser family (closed table; exact, case-sensitive match). */
const PRODUCTS: ReadonlyMap<string, Product> = new Map([
  ['Edg', product('Edge', 0)],
  ['EdgA', product('Edge', 0)],
  ['EdgiOS', product('Edge', 0)],
  ['Edge', product('Edge', 0)],
  ['OPR', product('Opera', 1)],
  ['OPT', product('Opera', 1)],
  ['SamsungBrowser', product('Samsung Internet', 2)],
  ['Firefox', product('Firefox', 3)],
  ['FxiOS', product('Firefox', 3)],
  ['CriOS', product('Chrome', 4)],
  ['Chrome', product('Chrome', 4)],
  ['Chromium', product('Chromium', 5)],
  ['Safari', product('Safari', 6, true)],
  ['Googlebot', product('Googlebot', 7)],
  ['bingbot', product('Bingbot', 7)],
  ['curl', product('curl', 8)],
  ['Wget', product('Wget', 8)],
  ['PostmanRuntime', product('Postman', 8)],
  ['okhttp', product('OkHttp', 8)],
  ['python-requests', product('Python Requests', 8)],
  ['Go-http-client', product('Go HTTP client', 8)],
]);

/** OS marker word (inside a comment) -> OS family, with its rank (lower wins). */
const SYSTEMS: ReadonlyMap<string, readonly [family: string, rank: number]> = new Map([
  ['iPhone', ['iOS', 0]],
  ['iPad', ['iOS', 0]],
  ['iPod', ['iOS', 0]],
  ['Android', ['Android', 1]],
  ['CrOS', ['ChromeOS', 2]],
  ['Windows', ['Windows', 3]],
  ['Macintosh', ['macOS', 4]],
  ['Linux', ['Linux', 5]],
  ['Ubuntu', ['Linux', 5]],
] as const);

/** Every browser family the parser can output. */
export const BROWSER_FAMILIES: readonly string[] = Object.freeze([...new Set([...PRODUCTS.values()].map(({ family }) => family))]);
/** Every OS family the parser can output. */
export const OS_FAMILIES: readonly string[] = Object.freeze([...new Set([...SYSTEMS.values()].map(([family]) => family))]);

const SEPARATORS: ReadonlySet<string> = new Set([' ', ';', ',', '(', ')']);
const SLASH = '/';
const ZERO = 48;
const NINE = 57;

/** The leading ASCII digits of `version` (1..4 of them), else null; reads at most five characters. */
function majorOf(version: string): string | null {
  let end = 0;
  while (end <= MAX_MAJOR_DIGITS && end < version.length) {
    const code = version.charCodeAt(end);
    if (code < ZERO || code > NINE) break;
    end += 1;
  }
  return end === 0 || end > MAX_MAJOR_DIGITS ? null : version.slice(0, end);
}

/** What one scan found, and the work it did. */
export interface UserAgentScan {
  /** `Family major / OS`, `Family major`, `Family / OS`, `Family`, or null. */
  readonly parsed: string | null;
  /** Characters visited + per word (1 + its length) (the exact work measure; at most 3 x 512). */
  readonly steps: number;
  /** Non-empty words classified. */
  readonly words: number;
}

interface Found {
  browser: Product | undefined;
  browserVersion: string;
  safariVersion: string;
  sawVersion: boolean;
  os: readonly [string, number] | undefined;
}

/** Classifies one word: a product token (`Name/Version`) and, inside a comment, an OS marker. Constant table work. */
function classify(word: string, inComment: boolean, found: Found): void {
  const slash = word.indexOf(SLASH);
  if (slash > 0) {
    const name = word.slice(0, slash);
    const version = word.slice(slash + 1);
    if (name === 'Version') {
      found.safariVersion = version;
      found.sawVersion = true;
    }
    const candidate = PRODUCTS.get(name);
    if (candidate !== undefined && (found.browser === undefined || candidate.rank < found.browser.rank)) {
      found.browser = candidate;
      found.browserVersion = version;
    }
  }
  if (!inComment) return;
  const system = SYSTEMS.get(word);
  if (system !== undefined && (found.os === undefined || system[1] < found.os[1])) found.os = system;
}

function assemble(found: Found): string | null {
  const { browser } = found;
  if (browser === undefined || (browser.versionFromVersionToken === true && !found.sawVersion)) return null;
  const major = majorOf(browser.versionFromVersionToken === true ? found.safariVersion : found.browserVersion);
  const name = major === null ? browser.family : `${browser.family} ${major}`;
  return found.os === undefined ? name : `${name} / ${found.os[0]}`;
}

/** Parses a header and reports the work done (the unit test's exact step bound). */
export function scanUserAgent(header: string): UserAgentScan {
  const input = header.length > MAX_USER_AGENT_SCAN ? header.slice(0, MAX_USER_AGENT_SCAN) : header;
  const found: Found = { browser: undefined, browserVersion: '', safariVersion: '', sawVersion: false, os: undefined };
  let steps = 0;
  let words = 0;
  let depth = 0;
  let start = 0;
  const close = (end: number): void => {
    if (end <= start) return;
    // One step for the word and one per character its classification reads (slice, indexOf).
    steps += 1 + (end - start);
    words += 1;
    classify(input.slice(start, end), depth > 0, found);
  };
  for (let index = 0; index < input.length; index += 1) {
    steps += 1;
    const char = input.charAt(index);
    if (!SEPARATORS.has(char)) continue;
    close(index);
    start = index + 1;
    if (char === '(') depth += 1;
    else if (char === ')' && depth > 0) depth -= 1;
  }
  close(input.length);
  return { parsed: assemble(found), steps, words };
}

/** `ua_parsed` of a raw `User-Agent` (the capture's `UserAgentParser`): browser family + major / OS family, or null. */
export const parseUserAgent = (header: string): string | null => scanUserAgent(header).parsed;
