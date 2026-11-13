/**
 * Native report -> JUnit case converters (TASK-011; ADR-0023 am. B, G item 1). Inputs are small synthetic reports in
 * the documented shape of each tool; a malformed report must never produce an empty (vacuously green) suite.
 */
import { describe, expect, it } from '@jest/globals';

import {
  convertNative,
  gitleaksToCases,
  hostScrubList,
  jestToCases,
  k6ToCases,
  lighthouseToCases,
  redactGitleaks,
  sanitizeNative,
  scrubCases,
  scrubPaths,
  strykerToCases,
  trivyToCases,
  zapToCases,
} from './convert.mjs';

const statuses = (cases: Array<{ status: string }>) => cases.map((c) => c.status);

describe('jestToCases', () => {
  const root = 'C:\\repo';
  const report = {
    testResults: [
      {
        name: 'C:\\repo\\prisma\\tests\\catalog\\c01.int.test.ts',
        status: 'failed',
        message: '',
        assertionResults: [
          { fullName: '[SEC-TC-05] C1 holds', status: 'passed', duration: 1200, failureMessages: [] },
          { fullName: 'C2 holds', status: 'failed', duration: 10, failureMessages: ['Error at C:\\repo\\x.ts:1'] },
          { title: 'later', ancestorTitles: ['group'], status: 'todo', failureMessages: [] },
        ],
      },
      { name: 'C:\\repo\\a.int.test.ts', status: 'failed', message: 'Cannot start container', assertionResults: [] },
    ],
  };

  it('[R-ARCH-16] maps passed/failed/todo, relativises file names and scrubs host paths from messages', () => {
    const cases = jestToCases(report, { root });
    expect(statuses(cases)).toEqual(['passed', 'failed', 'skipped', 'error']);
    expect(cases[0]).toMatchObject({ name: '[SEC-TC-05] C1 holds', classname: 'prisma/tests/catalog/c01.int.test.ts', time: 1.2 });
    expect(cases[1]?.message).toBe('Error at <root>\\x.ts:1');
    expect(cases[2]?.name).toBe('group later');
  });

  it('[R-ARCH-16] a test file that failed to run counts as an error case', () => {
    expect(jestToCases(report, { root })[3]).toMatchObject({
      status: 'error',
      classname: 'a.int.test.ts',
      message: 'Cannot start container',
    });
  });

  it('[R-ARCH-16] a malformed report is one error case', () => {
    expect(statuses(jestToCases({ nope: 1 }))).toEqual(['error']);
  });
});

describe('k6ToCases', () => {
  it('[R-ARCH-16] reads --summary-export thresholds (value = crossed) and checks', () => {
    const cases = k6ToCases(
      {
        metrics: {
          http_req_duration: { 'p(95)': 120, thresholds: { 'p(95)<500': false } },
          http_req_failed: { thresholds: { 'rate<0.01': true } },
        },
        root_group: { checks: { 'status 200': { name: 'status 200', passes: 10, fails: 0 } }, groups: {} },
      },
      { scenario: 'smoke' },
    );
    expect(cases.map((c) => [c.name, c.status])).toEqual([
      ['threshold http_req_duration: p(95)<500', 'passed'],
      ['threshold http_req_failed: rate<0.01', 'failed'],
      ['check status 200', 'passed'],
    ]);
    expect(cases[0]?.classname).toBe('k6.smoke');
  });

  it('[R-ARCH-16] reads handleSummary data ({ ok } thresholds, nested group checks)', () => {
    const cases = k6ToCases({
      metrics: { iterations: { thresholds: { 'count>0': { ok: true } } } },
      root_group: { checks: [], groups: [{ name: 'quote', checks: [{ name: 'fast', passes: 3, fails: 1 }], groups: [] }] },
    });
    expect(cases.map((c) => [c.name, c.status])).toEqual([
      ['threshold iterations: count>0', 'passed'],
      ['check quote > fast', 'failed'],
    ]);
  });

  it('[R-ARCH-16] a scenario without thresholds or checks asserts nothing and is an error', () => {
    expect(statuses(k6ToCases({ metrics: {} }))).toEqual(['error']);
  });
});

describe('lighthouseToCases', () => {
  const urls = ['http://web/en/', 'http://web/fr/'];
  it('[R-ARCH-16] one case per URL; error-level failures fail it, warn-level are reported only', () => {
    const cases = lighthouseToCases(
      [
        {
          url: 'http://web/en/',
          level: 'error',
          auditId: 'largest-contentful-paint',
          name: 'maxNumericValue',
          operator: '<=',
          expected: 2500,
          actual: 3100,
          passed: false,
        },
        {
          url: 'http://web/fr/',
          level: 'warn',
          auditId: 'uses-long-cache-ttl',
          name: 'minScore',
          operator: '>=',
          expected: 0.9,
          actual: 0.5,
          passed: false,
        },
      ],
      { urls },
    );
    expect(cases.map((c) => [c.name, c.status])).toEqual([
      ['lighthouse assertions http://web/en/', 'failed'],
      ['lighthouse assertions http://web/fr/', 'passed'],
    ]);
    expect(cases[0]?.message).toContain('largest-contentful-paint');
  });

  it('[R-ARCH-16] an empty URL list is an error (nothing collected)', () => {
    expect(statuses(lighthouseToCases([], { urls: [] }))).toEqual(['error']);
  });
});

describe('zapToCases', () => {
  const report = {
    site: [
      {
        '@name': 'http://edge',
        alerts: [
          { pluginid: '10038', name: 'CSP header not set', riskcode: '2', riskdesc: 'Medium (High)', count: '3' },
          { pluginid: '10021', name: 'X-Content-Type-Options missing', riskcode: '1', riskdesc: 'Low (Medium)' },
          { pluginid: '10098', name: 'Cross-domain misconfiguration', riskcode: '2', riskdesc: 'Medium (Medium)' },
        ],
      },
    ],
  };
  it('[R-ARCH-16] fails alerts at or above Medium unless the rules file ignores them', () => {
    expect(statuses(zapToCases(report, { ignore: ['10098'] }))).toEqual(['passed', 'failed', 'passed', 'passed']);
    expect(statuses(zapToCases(report, { failAtRisk: 1 }))).toEqual(['passed', 'failed', 'failed', 'failed']);
  });
});

describe('trivyToCases', () => {
  it('[R-ARCH-16] one case per target and finding class; HIGH and CRITICAL fail by default', () => {
    const cases = trivyToCases({
      SchemaVersion: 2,
      ArtifactName: 'platform-api:local',
      Results: [
        {
          Target: 'debian 12',
          Class: 'os-pkgs',
          Vulnerabilities: [
            {
              VulnerabilityID: 'CVE-2026-0001',
              PkgName: 'openssl',
              InstalledVersion: '3.0.1',
              FixedVersion: '3.0.2',
              Severity: 'CRITICAL',
            },
            { VulnerabilityID: 'CVE-2026-0002', PkgName: 'zlib', InstalledVersion: '1', Severity: 'LOW' },
          ],
        },
        {
          Target: 'Dockerfile',
          Class: 'config',
          Misconfigurations: [{ AVDID: 'AVD-DS-0002', Title: 'root user', Severity: 'HIGH', Status: 'PASS' }],
        },
        { Target: 'app/node_modules', Class: 'lang-pkgs' },
      ],
    });
    expect(cases.map((c) => [c.name, c.status])).toEqual([
      ['trivy platform-api:local debian 12 vulnerabilities', 'failed'],
      ['trivy platform-api:local Dockerfile misconfigurations', 'passed'],
      ['trivy platform-api:local app/node_modules (lang-pkgs) clean', 'passed'],
    ]);
    expect(cases[0]?.message).toContain('CVE-2026-0001');
    expect(cases[0]?.message).not.toContain('CVE-2026-0002');
  });

  it('[R-ARCH-16] a report without SchemaVersion/Results is an error', () => {
    expect(statuses(trivyToCases({ foo: 1 }))).toEqual(['error']);
  });
});

describe('gitleaksToCases and redaction', () => {
  // Synthetic finding; the value fields are generated at run time so no secret-shaped literal exists in the source.
  const value = Array.from({ length: 24 }, (_, i) => String.fromCharCode(97 + ((i * 7) % 26))).join('');
  const finding = {
    RuleID: 'generic-api-key',
    File: 'apps/api/x.ts',
    StartLine: 3,
    Commit: '0123456789abcdef',
    Secret: value,
    Match: `k=${value}`,
    Line: `const k=${value}`,
  };

  it('[R-ARCH-16] lists findings by rule, file, line and short commit, never by value', () => {
    expect(statuses(gitleaksToCases([]))).toEqual(['passed']);
    const [kase] = gitleaksToCases([finding]);
    expect(kase?.status).toBe('failed');
    expect(kase?.message).toBe('generic-api-key apps/api/x.ts:3 0123456');
    expect(JSON.stringify(kase)).not.toContain(value);
  });

  it('[R-ARCH-16] the committed native report has every value-bearing field redacted', () => {
    const redacted = JSON.stringify(redactGitleaks([finding]));
    expect(redacted).not.toContain(value);
    expect(JSON.stringify(sanitizeNative('gitleaks', [finding]))).toBe(redacted);
    expect(sanitizeNative('trivy', { a: 1 })).toEqual({ a: 1 });
  });
});

describe('strykerToCases', () => {
  const report = {
    schemaVersion: '2',
    thresholds: { high: 80, low: 60, break: 70 },
    files: {
      'packages/pricing/src/a.ts': {
        mutants: [{ status: 'Killed' }, { status: 'Timeout' }, { status: 'Survived' }, { status: 'Ignored' }],
      },
      'packages/pricing/src/b.ts': { mutants: [{ status: 'NoCoverage' }] },
    },
  };
  it('[R-ARCH-16] per-file informational cases and one gating case against thresholds.break', () => {
    const cases = strykerToCases(report);
    expect(cases.map((c) => [c.name, c.status])).toEqual([
      ['stryker packages/pricing/src/a.ts', 'passed'],
      ['stryker packages/pricing/src/b.ts', 'passed'],
      ['stryker mutation score >= 70', 'failed'],
    ]);
    expect(cases[2]?.message).toBe('mutation score 50.00 % (2/4)');
    expect(statuses(strykerToCases(report, { breakAt: 50 })).at(-1)).toBe('passed');
  });
});

describe('convertNative and scrubPaths', () => {
  it('[R-ARCH-16] dispatches by converter name with options from suite-runners.json', () => {
    expect(statuses(convertNative('gitleaks', []))).toEqual(['passed']);
    expect(convertNative('k6', { metrics: { m: { thresholds: { x: false } } } }, { scenario: 'smoke' })[0]?.classname).toBe('k6.smoke');
  });

  it('[R-ARCH-16] replaces host paths in both separator styles', () => {
    expect(scrubPaths('at C:\\Users\\me\\repo\\a.ts and C:/Users/me/repo/b.ts', ['C:\\Users\\me\\repo'])).toBe(
      'at <root>\\a.ts and <root>/b.ts',
    );
  });
});

describe('host path scrubbing (PR28-SEC-02, CWE-532)', () => {
  // A fake Windows host: the temp directory is reported in 8.3 form, the home directory in long form.
  const shortTmp = String.raw`C:\Users\ABCDEF~1\AppData\Local\Temp`;
  const longHome = String.raw`C:\Users\Abcdefghi`;
  const longTmp = String.raw`C:\Users\Abcdefghi\AppData\Local\Temp`;
  const repo = String.raw`D:\work\shipqube`;
  const env = { TEMP: shortTmp, TMP: shortTmp, USERPROFILE: longHome, PATH: String.raw`C:\Windows` };
  const realpath = (path: string): string => (path.includes('~1') ? path.replace(String.raw`ABCDEF~1`, 'Abcdefghi') : path);
  const list = hostScrubList({ repoRoot: repo, homeDir: longHome, tmpDir: shortTmp, env, realpath });

  it('the list holds the root, home, temp directory, their real paths and the env values, longest first', () => {
    expect(list).toEqual(expect.arrayContaining([repo, longHome, shortTmp, longTmp]));
    expect(list.map((p) => p.length)).toEqual([...list.map((p) => p.length)].sort((a, b) => b - a));
    expect(new Set(list).size).toBe(list.length);
    expect(list).not.toContain(String.raw`C:\Windows`);
  });

  it('drops file system roots, one-segment values, trailing separators and unreadable real paths', () => {
    const odd = hostScrubList({
      repoRoot: 'C:\\',
      homeDir: '/',
      tmpDir: '/tmp/',
      env: { TMPDIR: '/x', HOME: undefined },
      realpath: () => {
        throw new Error('ENOENT');
      },
    });
    expect(odd).toEqual(['/tmp']);
  });

  it('the 8.3 temp directory, its long form and a title built from them leave no user-name fragment', () => {
    const title = `refuses a path that is not under /run/secrets: ${shortTmp}\\outside-ab12\\s and ${longTmp.replaceAll('\\', '/')}/x`;
    const out = scrubPaths(title, list);
    expect(out).not.toMatch(/ABCDEF|Abcdef|~1/i);
    expect(out).toContain('refuses a path that is not under /run/secrets: <root>');
  });

  it('JSON-escaped backslashes (a native report written with JSON.stringify) are scrubbed too', () => {
    const json = JSON.stringify({ file: `${repo}\\a.ts`, tmp: `${shortTmp}\\x` });
    const out = scrubPaths(json, list);
    expect(out).not.toMatch(/shipqube|ABCDEF|~1/);
    expect(out).toContain('<root>');
  });

  it('Windows prefixes match case-insensitively, POSIX prefixes exactly', () => {
    expect(scrubPaths(String.raw`c:\users\abcdef~1\appdata\local\temp\q`, [shortTmp])).toBe(String.raw`<root>\q`);
    expect(scrubPaths('/Tmp/x and /tmp/x', ['/tmp'])).toBe('/Tmp/x and <root>/x');
  });

  it.each([
    [String.raw`at C:\Users\SomeoneElse\proj\a.ts:1`, '<home>'],
    [String.raw`at c:/users/someoneelse/proj/a.ts`, '<home>'],
    ['at /Users/someone/proj/a.ts', '<home>'],
    ['at /home/someone/proj/a.ts', '<home>'],
    ['at /c/Users/someone/proj/a.ts', '<home>'],
    ['at /mnt/c/Users/someone/proj/a.ts', '<home>'],
    ['at file:///C:/Users/someone/proj/a.ts', '<home>'],
    [String.raw`at E:\scratch\ABCDEF~1\a.ts`, '<short>'],
  ])('the generic pass catches a profile path the list missed: %s', (text, marker) => {
    const out = scrubPaths(text, []);
    expect(out).toContain(marker);
    expect(out).not.toMatch(/someone|SomeoneElse|ABCDEF/i);
  });

  it.each([
    ['no host path here, just /usr/lib/node and a/b/c'],
    ['a ratio of a~1 and the word users'],
    ['the /homepage route and /Usersettings'],
  ])('the generic pass leaves ordinary text alone: %s', (text) => {
    expect(scrubPaths(text, [])).toBe(text);
  });

  it('scrubCases scrubs name, classname and message of every case, and only those', () => {
    const cases = [
      { name: `t ${shortTmp}\\q`, classname: `${repo}\\a.test.ts`, status: 'failed' as const, message: `at ${longTmp}\\z`, time: 1 },
      { name: 'plain', classname: 'plain', status: 'passed' as const },
    ];
    const out = scrubCases(cases, list);
    expect(JSON.stringify(out)).not.toMatch(/ABCDEF|Abcdef|shipqube/i);
    expect(out[0]).toMatchObject({ status: 'failed', time: 1 });
    expect(out[1]).toEqual(cases[1]);
  });

  it('jestToCases scrubs test titles and file names, not only failure messages (the bootstrap.test.ts leak)', () => {
    const report = {
      testResults: [
        {
          name: `${repo}\\tools\\db\\bootstrap.test.ts`,
          status: 'passed',
          assertionResults: [
            {
              fullName: `refuses a path: ${shortTmp}\\bootstrap-unit-x1\\outside-y2\\s`,
              status: 'passed',
              duration: 1,
              failureMessages: [],
            },
            { fullName: 'fine', status: 'passed', duration: 1, failureMessages: [] },
          ],
        },
      ],
    };
    const cases = jestToCases(report, { root: repo, scrub: list });
    expect(JSON.stringify(cases)).not.toMatch(/ABCDEF|Abcdef|~1/i);
    expect(cases[0]).toMatchObject({
      name: 'refuses a path: <root>\\bootstrap-unit-x1\\outside-y2\\s',
      classname: 'tools/db/bootstrap.test.ts',
    });
  });
});
