/**
 * The in-house user-agent parser for `audit_entries.ua_parsed` (data-model §3.4; D-ARCH-141; TASK-028). The output is
 * assembled from a closed family table and digits only, so a crafted header cannot place free text into an INT column;
 * the scan is single-pass and its work is counted in steps, so the bound is exact, never a wall-clock one
 * (D-SEC-PR53-02).
 */
import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import { isAuditUaParsed } from '../entry.js';
import { BROWSER_FAMILIES, MAX_USER_AGENT_SCAN, OS_FAMILIES, parseUserAgent, scanUserAgent } from './user-agent.js';

const FIREFOX_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:146.0) Gecko/20100101 Firefox/146.0';
const CHROME_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const EDGE_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.2903.70';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.81 Mobile Safari/537.36';
const SAMSUNG_ANDROID =
  'Mozilla/5.0 (Linux; Android 13; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36';
const OPERA_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0';
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0';
const CHROME_OS = 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const CHROME_IOS =
  'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1';
const FIREFOX_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/133.0 Mobile/15E148 Safari/605.1.15';

describe('[D-ARCH-141] parseUserAgent: browser family + major / OS family', () => {
  it.each([
    [FIREFOX_WINDOWS, 'Firefox 146 / Windows'],
    [CHROME_MAC, 'Chrome 131 / macOS'],
    [EDGE_WINDOWS, 'Edge 131 / Windows'],
    [SAFARI_IPHONE, 'Safari 17 / iOS'],
    [CHROME_ANDROID, 'Chrome 131 / Android'],
    [SAMSUNG_ANDROID, 'Samsung Internet 26 / Android'],
    [OPERA_WINDOWS, 'Opera 115 / Windows'],
    [FIREFOX_LINUX, 'Firefox 133 / Linux'],
    [CHROME_OS, 'Chrome 131 / ChromeOS'],
    [CHROME_IOS, 'Chrome 131 / iOS'],
    [FIREFOX_IOS, 'Firefox 133 / iOS'],
    ['curl/8.11.1', 'curl 8'],
    ['PostmanRuntime/7.43.0', 'Postman 7'],
    ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Googlebot 2'],
  ])('%s -> %s', (header, expected) => {
    expect(parseUserAgent(header)).toBe(expected);
    expect(isAuditUaParsed(expected)).toBe(true);
  });

  it('null for an empty value, an unknown client, or text without a known family', () => {
    for (const header of ['', 'UnknownClient/1.0', 'Mozilla/5.0 (Windows NT 10.0)', 'hello world', '()()/;;']) {
      expect(parseUserAgent(header)).toBeNull();
    }
  });

  it('a family without a numeric major version is reported without one; a version over four digits is dropped', () => {
    expect(parseUserAgent('Firefox/abc (Windows NT 10.0)')).toBe('Firefox / Windows');
    expect(parseUserAgent('Firefox/123456.1')).toBe('Firefox');
  });

  it('a crafted token cannot carry free text: family names come from the table, versions are digits only', () => {
    const crafted = 'Firefox/146<script>alert(1)</script>;evil@example.com (Windows NT 10.0; owner=jane.doe@example.com)';
    expect(parseUserAgent(crafted)).toBe('Firefox 146 / Windows');
    expect(parseUserAgent('Firefox Evil/146')).toBeNull();
  });

  it('the input is cut at 512 characters: a family past the cut is not seen', () => {
    expect(parseUserAgent(`${'x'.repeat(MAX_USER_AGENT_SCAN)} Firefox/146.0`)).toBeNull();
    expect(parseUserAgent(`${'x'.repeat(MAX_USER_AGENT_SCAN - 14)} Firefox/146.0`)).toBe('Firefox 146');
  });

  it('every output is in the writer shape and assembled from the closed tables (property)', () => {
    const families = new Set<string>(BROWSER_FAMILIES);
    const systems = new Set<string>(OS_FAMILIES);
    fc.assert(
      fc.property(fc.string({ maxLength: 700, unit: 'binary' }), (header) => {
        const parsed = parseUserAgent(header);
        if (parsed === null) return;
        expect(isAuditUaParsed(parsed)).toBe(true);
        const [browser = '', os] = parsed.split(' / ');
        expect(families.has(browser.replace(/ \d{1,4}$/, ''))).toBe(true);
        if (os !== undefined) expect(systems.has(os)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});

describe('[D-SEC-PR53-02] scanUserAgent: linear work with an exact step bound (never a wall-clock bound)', () => {
  it('a step is one character visited or one word classified; the work of a value is exact', () => {
    // 11 characters, 2 words (`curl/8.11.1` is one word, the end of the input closes it): 11 + 1.
    expect(scanUserAgent('curl/8.11.1').steps).toBe(12);
    expect(scanUserAgent('a b').steps).toBe(3 + 2);
    expect(scanUserAgent('').steps).toBe(0);
  });

  it.each([
    ['512 separators (every character closes an empty word)', '('.repeat(512)],
    ['512 alternating word characters and separators', 'a;'.repeat(256)],
    ['512 characters of one slash-heavy word', '/'.repeat(512)],
    ['nested comments 256 deep', `${'('.repeat(256)}${')'.repeat(256)}`],
    ['a repeated product token', 'Firefox/1 '.repeat(52).slice(0, 512)],
  ])('adversarial 512-character input: %s', (_label, header) => {
    expect(header).toHaveLength(MAX_USER_AGENT_SCAN);
    const { steps, words } = scanUserAgent(header);
    // Exact: one step per character plus one per non-empty word; the bound is 2 x 512.
    expect(steps).toBe(MAX_USER_AGENT_SCAN + words);
    expect(steps).toBeLessThanOrEqual(2 * MAX_USER_AGENT_SCAN);
  });

  it('a longer header does no more work than its first 512 characters', () => {
    const long = `${'a;'.repeat(5_000)}Firefox/146`;
    expect(scanUserAgent(long).steps).toBe(scanUserAgent(long.slice(0, MAX_USER_AGENT_SCAN)).steps);
  });

  it('the step count never exceeds 2 x min(length, 512) for any input (property)', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 1_200, unit: 'binary' }), (header) => {
        const { steps, words } = scanUserAgent(header);
        const visited = Math.min(header.length, MAX_USER_AGENT_SCAN);
        expect(steps).toBe(visited + words);
        expect(steps).toBeLessThanOrEqual(2 * visited);
      }),
      { numRuns: 300 },
    );
  });
});
