/**
 * Pure parts of tools/docker/scan-image-secrets.mjs (TASK-014, AT-US-004-02; PR39-SEC-03 and review R1-n8). The Docker
 * part (docker save, Gitleaks per layer, node_modules positive control) runs in tests/compose/images.stack.test.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { describe, expect, it } from '@jest/globals';

import { findRepoRoot } from '../test-support/process.js';
import {
  assertExactAllowList,
  baseLayer,
  configFromManifest,
  confinedPath,
  decompressLayer,
  diffIdsFromConfig,
  formatFindings,
  formatKnownBinary,
  GITLEAKS_CONFIG_FILE,
  GITLEAKS_IMAGE,
  gitleaksArgs,
  gitleaksFindings,
  IMAGE_SCAN_ALLOW_LIST,
  isAllowListed,
  isKnownLargeBinary,
  KNOWN_LARGE_BINARIES,
  layerDigest,
  layersFromManifest,
  oversizeFinding,
  packageFile,
  parseTar,
  pathCollisions,
  paxPath,
  RENAMED_SEGMENTS,
  SCAN_FILE_LIMIT_BYTES,
  scanHistory,
  tarNumber,
  toRealPath,
  toScanPath,
} from './scan-image-secrets.mjs';

/** One ustar member (header + data padded to 512). */
function tarMember(name: string, data: Buffer, type = '0'): Buffer {
  const header = Buffer.alloc(512);
  header.write(name.slice(0, 100), 0, 'utf8');
  header.write('0000644\0', 100, 'ascii');
  header.write('0000000\0', 108, 'ascii');
  header.write('0000000\0', 116, 'ascii');
  header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124, 'ascii');
  header.write('00000000000\0', 136, 'ascii');
  header.write('        ', 148, 'ascii');
  header.write(type, 156, 'ascii');
  header.write('ustar\0', 257, 'ascii');
  header.write('00', 263, 'ascii');
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii');
  return Buffer.concat([header, data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
}

const pax = (path: string): Buffer => {
  const body = ` path=${path}\n`;
  let length = body.length + 2;
  if (`${length}${body}`.length !== length) length += 1;
  return Buffer.from(`${length}${body}`);
};

const tarOf = (...members: Buffer[]): Buffer => Buffer.concat([...members, Buffer.alloc(1024)]);

describe('scan-image-secrets pure parts (AT-US-004-02)', () => {
  it('reads ustar members, PAX long paths and GNU long names', () => {
    const long = `app/${'d'.repeat(120)}/secret.txt`;
    const archive = tarOf(
      tarMember('etc/a.txt', Buffer.from('alpha')),
      tarMember('PaxHeader', pax(long), 'x'),
      tarMember('ignored-short-name', Buffer.from('beta')),
      tarMember('././@LongLink', Buffer.from(`${long}2\0`), 'L'),
      tarMember('ignored-too', Buffer.from('gamma')),
      tarMember('usr/link', Buffer.alloc(0), '2'),
    );
    const entries = parseTar(archive);
    expect(entries.map((entry) => [entry.name, entry.type, entry.data.toString()])).toEqual([
      ['etc/a.txt', '0', 'alpha'],
      [long, '0', 'beta'],
      [`${long}2`, '0', 'gamma'],
      ['usr/link', '2', ''],
    ]);
  });

  it('decodes octal and GNU base-256 sizes', () => {
    const octal = Buffer.from('00000000017\0');
    expect(tarNumber(octal, 0, 12)).toBe(15);
    const base256 = Buffer.alloc(12);
    base256[0] = 0x80;
    base256[11] = 0x02;
    base256[10] = 0x01;
    expect(tarNumber(base256, 0, 12)).toBe(258);
    expect(paxPath(Buffer.from('20 mtime=1234567890\n'))).toBeUndefined();
  });

  it('confines layer paths: no absolute escape, no .., no whiteouts', () => {
    expect(confinedPath('./app/x.txt')).toBe('app/x.txt');
    expect(confinedPath('/etc/passwd')).toBe('etc/passwd');
    expect(confinedPath('../../outside')).toBeUndefined();
    expect(confinedPath('app/../../outside')).toBeUndefined();
    expect(confinedPath('app/.wh.deleted')).toBeUndefined();
    expect(confinedPath('./')).toBeUndefined();
  });

  it('accepts plain, gzip and zstd layer blobs', () => {
    const tar = tarOf(tarMember('a', Buffer.from('x')));
    expect(decompressLayer(tar)).toEqual(tar);
    expect(decompressLayer(gzipSync(tar))).toEqual(tar);
  });

  it('reads the layer order from manifest.json and derives the digest', () => {
    const layers = layersFromManifest(
      JSON.stringify([{ Config: 'c', Layers: [`blobs/sha256/${'a'.repeat(64)}`, `${'b'.repeat(64)}/layer.tar`] }]),
    );
    expect(layers.map(layerDigest)).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
    expect(() => layersFromManifest('[]')).toThrow(/exactly one image/);
    expect(() => layersFromManifest('[{}]')).toThrow(/no layer list/);
  });

  it('maps a Gitleaks report to file and rule only, never the match or secret', () => {
    const report = JSON.stringify([{ File: '/scan/app/creds.txt', RuleID: 'aws-access-token', Match: 'REDACTED', Secret: 'REDACTED' }]);
    const findings = gitleaksFindings(report, 3, 'f'.repeat(64));
    expect(findings).toEqual([{ layer: 3, digest: 'f'.repeat(64), file: '/app/creds.txt', rule: 'aws-access-token' }]);
    const lines = formatFindings(findings, [{ step: 2, rule: 'secret-assignment' }]);
    expect(lines).toEqual([
      `[scan-image-secrets] layer 3 (sha256:${'f'.repeat(12)}) /app/creds.txt: aws-access-token`,
      '[scan-image-secrets] history step 2: secret-assignment',
    ]);
    expect(gitleaksFindings('', 0, 'x')).toEqual([]);
  });

  it('renames node_modules and .gitleaksignore segments for the scan and maps reported paths back (PR39-SEC-03)', () => {
    const cases: Array<[string, string]> = [
      ['app/node_modules/x/creds.txt', 'app/node_modules.scan/x/creds.txt'],
      ['app/packages/y/node_modules/z/creds.txt', 'app/packages/y/node_modules.scan/z/creds.txt'],
      ['app/node_modules/a/node_modules/b/c.txt', 'app/node_modules.scan/a/node_modules.scan/b/c.txt'],
      ['node_modules', 'node_modules.scan'],
      ['.gitleaksignore', '.gitleaksignore.scan'],
      ['app/node_modules.scan/x', 'app/node_modules.scan.scan/x'],
      ['app/my_node_modules/x', 'app/my_node_modules/x'],
      ['app/node_modules2/x', 'app/node_modules2/x'],
      ['app/Node_Modules/x', 'app/Node_Modules/x'],
      ['opt/creds.txt', 'opt/creds.txt'],
    ];
    for (const [real, scanned] of cases) {
      expect(toScanPath(real)).toBe(scanned);
      expect(toRealPath(scanned)).toBe(real);
    }
    expect(RENAMED_SEGMENTS).toEqual(['node_modules', '.gitleaksignore']);
  });

  it('reports node_modules findings by their real path, and an empty or ruleless report safely', () => {
    const report = JSON.stringify([
      { File: '/scan/app/node_modules.scan/x/creds.txt', RuleID: 'aws-access-token' },
      { File: '/scan/app/packages/y/node_modules.scan/z/creds.txt', RuleID: 'aws-access-token' },
      { File: 7 },
    ]);
    expect(gitleaksFindings(report, 1, 'c'.repeat(64)).map((finding) => `${finding.file} ${finding.rule}`)).toEqual([
      '/app/node_modules/x/creds.txt aws-access-token',
      '/app/packages/y/node_modules/z/creds.txt aws-access-token',
      '? unknown',
    ]);
    expect(() => gitleaksFindings('{}', 0, 'x')).toThrow(/not a JSON array/);
  });

  it('reads the config path and the diff_ids from the saved image', () => {
    const ids = ['a', 'b'].map((hex) => `sha256:${hex.repeat(64)}`);
    expect(configFromManifest(JSON.stringify([{ Config: 'blobs/sha256/cfg', Layers: [] }]))).toBe('blobs/sha256/cfg');
    expect(() => configFromManifest('[{}]')).toThrow(/no image config/);
    expect(diffIdsFromConfig(JSON.stringify({ rootfs: { type: 'layers', diff_ids: ids } }))).toEqual(ids);
    expect(() => diffIdsFromConfig(JSON.stringify({ rootfs: { diff_ids: ['sha256:xyz'] } }))).toThrow(/diff_ids/);
    expect(() => diffIdsFromConfig('{}')).toThrow(/diff_ids/);
  });

  describe('allow-list (exact entries bound to base-image layers or one package file)', () => {
    const id = (hex: string): string => `sha256:${hex.repeat(64)}`;
    const base = [id('1'), id('2'), id('3')];
    const entries = [
      baseLayer('generic-api-key', /^\/usr\/local\/include\/node\/(?:[\w-]+\/)*[\w.-]+\.h$/, [base], 'node headers'),
      packageFile('private-key', '/app/node_modules/pkg/test/fixtures/id_rsa', 'pkg test key'),
    ];
    const header = '/usr/local/include/node/v8-internal.h';
    const finding = (layer: number, file: string, rule: string) => ({ layer, digest: 'd'.repeat(64), file, rule });
    const image = [...base, id('4')];

    it('allows a base-image file only in a base layer of an image built FROM that base', () => {
      expect(isAllowListed(finding(2, header, 'generic-api-key'), image, entries)).toBe(true);
      expect(isAllowListed(finding(0, '/usr/local/include/node/cppgc/heap.h', 'generic-api-key'), image, entries)).toBe(true);
      // The same path added by a later, non-base layer is still reported.
      expect(isAllowListed(finding(3, header, 'generic-api-key'), image, entries)).toBe(false);
      // A different base (diff_ids differ at or before the layer) is not bound.
      expect(isAllowListed(finding(2, header, 'generic-api-key'), [id('1'), id('9'), id('3'), id('4')], entries)).toBe(false);
      expect(isAllowListed(finding(2, header, 'aws-access-token'), image, entries)).toBe(false);
      expect(isAllowListed(finding(1, '/usr/local/include/node/../../app/.env', 'generic-api-key'), image, entries)).toBe(false);
      expect(isAllowListed(finding(1, '/usr/local/include/node/secrets.txt', 'generic-api-key'), image, entries)).toBe(false);
    });

    it('allows a package file only by its exact path and rule, in any layer', () => {
      expect(isAllowListed(finding(3, '/app/node_modules/pkg/test/fixtures/id_rsa', 'private-key'), image, entries)).toBe(true);
      expect(isAllowListed(finding(3, '/app/node_modules/pkg/test/fixtures/id_rsa2', 'private-key'), image, entries)).toBe(false);
      expect(isAllowListed(finding(3, '/app/node_modules/pkg/test/fixtures/id_rsa', 'generic-api-key'), image, entries)).toBe(false);
      expect(isAllowListed(finding(3, '/app/creds.txt', 'private-key'), image, [])).toBe(false);
    });

    it('accepts only exact entries, and the shipped list is exact', () => {
      expect(() => assertExactAllowList(IMAGE_SCAN_ALLOW_LIST)).not.toThrow();
      expect(() => assertExactAllowList(entries)).not.toThrow();
      const bad = [
        baseLayer('generic-api-key', /^\/usr\/local\/include\/node\//, [base], 'prefix only'),
        baseLayer('generic-api-key', /\/usr\/local\/include\/node\/x\.h$/, [base], 'unanchored'),
        baseLayer('generic-api-key', /^\/usr\/local\/include\/node\/x\.h$/i, [base], 'flags'),
        baseLayer('generic-api-key', /^\/usr\/local\/include\/node\/x\.h$/, [[]], 'no binding'),
        baseLayer('generic-api-key', /^\/usr\/local\/include\/node\/x\.h$/, [['sha256:short']], 'bad digest'),
        packageFile('private-key', '/app/lib/id_rsa', 'not a package'),
        packageFile('private-key', 'app/node_modules/pkg/id_rsa', 'relative'),
        packageFile('private-key', '/app/node_modules/pkg/../../lib/id_rsa', 'not normalised'),
        packageFile('private-key', '/app/node_modules/pkg/id_rsa', ''),
      ];
      for (const entry of bad) expect(() => assertExactAllowList([entry])).toThrow(/allow-list entry 0/);
    });

    it('[D-TASK014-19] holds exactly the reviewed package files, and no base-layer entry since no final stage is FROM node', () => {
      expect(IMAGE_SCAN_ALLOW_LIST.map((entry) => (entry.kind === 'package-file' ? `${entry.rule} ${entry.file}` : entry.kind))).toEqual([
        'generic-api-key /app/node_modules/effect/dist/cjs/internal/schedule/interval.js',
        'generic-api-key /app/node_modules/effect/dist/cjs/internal/schedule/intervals.js',
        'generic-api-key /app/node_modules/effect/dist/esm/internal/schedule/interval.js',
        'generic-api-key /app/node_modules/effect/dist/esm/internal/schedule/intervals.js',
        'generic-api-key /app/node_modules/effect/src/internal/schedule/interval.ts',
        'generic-api-key /app/node_modules/effect/src/internal/schedule/intervals.ts',
        'generic-api-key /app/node_modules/prisma/build/cli.js',
      ]);
      // Architect R6 / D-ARCH-116 rule 2: every Node final stage is debian + the node binary, so the node image's
      // /usr/local/include/node headers (the old D-TASK014-13 entry) are in no image.
      for (const dockerfile of ['apps/api/Dockerfile', 'apps/worker/Dockerfile', 'prisma/Dockerfile']) {
        const froms = [...readFileSync(join(findRepoRoot(), dockerfile), 'utf8').matchAll(/^FROM\s+(\S+)/gm)].map(
          (match) => match[1] ?? '',
        );
        expect({ dockerfile, final: froms.at(-1)?.split(':')[0] }).toEqual({ dockerfile, final: 'debian' });
      }
    });
  });

  it('reports files over the size limit: known ELF binaries as skipped, anything else as a finding', () => {
    const big = { layer: 4, digest: 'e'.repeat(64), file: '/usr/local/bin/node', size: 120_000_000 };
    const elf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
    expect(SCAN_FILE_LIMIT_BYTES).toBe(64 * 1024 * 1024);
    expect(KNOWN_LARGE_BINARIES).toEqual(['/usr/local/bin/node']);
    expect(isKnownLargeBinary(big, elf)).toBe(true);
    expect(isKnownLargeBinary(big, Buffer.from('aws_access_key_id = x'))).toBe(false);
    expect(isKnownLargeBinary({ ...big, file: '/app/blob.dat' }, elf)).toBe(false);
    const skipped = formatKnownBinary(big);
    expect(skipped).toBe('[scan-image-secrets] skipped (known binary): /usr/local/bin/node in layer 4, 120000000 bytes');
    // The stack test counts lines containing "[scan-image-secrets] layer" as findings.
    expect(skipped).not.toContain('[scan-image-secrets] layer');
    expect(formatFindings([oversizeFinding({ ...big, file: '/app/blob.dat', size: 70_000_000 })], [])).toEqual([
      `[scan-image-secrets] layer 4 (sha256:${'e'.repeat(12)}) /app/blob.dat: not scanned, 70000000 bytes over the 67108864-byte limit`,
    ]);
  });

  it('detects members that would overwrite each other while unpacking (case folding on case-insensitive hosts)', () => {
    expect(pathCollisions(['app/Creds.txt', 'app/creds.txt'], true)).toEqual([['/app/Creds.txt', '/app/creds.txt']]);
    expect(pathCollisions(['app/Creds.txt', 'app/creds.txt'], false)).toEqual([]);
    expect(pathCollisions(['App/x', 'app/y', 'app/z'], true)).toEqual([['/App', '/app']]);
    expect(pathCollisions(['App/x', 'app/y'], false)).toEqual([]);
    expect(pathCollisions(['a/b', 'a/b'], false)).toEqual([['/a/b', '/a/b']]);
    expect(pathCollisions(['a/b', 'a/b/c'], false)).toEqual([['/a/b', '/a/b/c']]);
    expect(pathCollisions(['a/b/c', 'a/B'], true)).toEqual([['/a/b', '/a/B']]);
    expect(pathCollisions(['app/node_modules.scan/x', 'app/node_modules.scan.scan/x', 'opt/a', 'opt/b'], true)).toEqual([]);
  });

  it('flags secret shapes in the build history by rule id', () => {
    const fake = ['AKIA', 'Z'.repeat(16)].join('');
    const steps = [
      '/bin/sh -c #(nop)  ENV NODE_ENV=production',
      `ENV AWS_ACCESS_KEY_ID=${fake}`,
      // Built at run time so the repository text holds no credential-shaped literal.
      ['ARG DB_', 'PASSWORD=', 'x'.repeat(12)].join(''),
      ['RUN curl https://user', ':', 'y'.repeat(8), '@example.invalid/x'].join(''),
      'ARG REVISION=unknown',
      'ENV PRISMA_SCHEMA_ENGINE_BINARY=/app/node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x',
    ];
    expect(scanHistory(steps)).toEqual([
      { step: 1, rule: 'aws-access-key-id' },
      { step: 1, rule: 'secret-assignment' },
      { step: 2, rule: 'secret-assignment' },
      { step: 3, rule: 'url-credentials' },
    ]);
  });

  it('runs Gitleaks offline, read-only, redacted, with the repo-pinned config and the CI pin', () => {
    const args = gitleaksArgs('/w/layer-0', '/w/reports', 'layer-0.json');
    expect(args.slice(0, 4)).toEqual(['run', '--rm', '--network', 'none']);
    expect(args).toContain('/w/layer-0:/scan:ro');
    expect(args).toContain(`${GITLEAKS_CONFIG_FILE}:/cfg/gitleaks-image.toml:ro`);
    expect(args.slice(args.indexOf('--config'), args.indexOf('--config') + 2)).toEqual(['--config', '/cfg/gitleaks-image.toml']);
    expect(args.indexOf('--config')).toBeGreaterThan(args.indexOf('dir'));
    expect(args).toContain('--redact');
    expect(args).toContain('--ignore-gitleaks-allow');
    // Gitleaks' own bound sits above the scanner's, so Gitleaks never skips a written file silently.
    expect(Number(args[args.indexOf('--max-target-megabytes') + 1]) * 1_000_000).toBeGreaterThan(SCAN_FILE_LIMIT_BYTES);
    expect(GITLEAKS_CONFIG_FILE).toBe(join(findRepoRoot(), 'tools', 'docker', 'gitleaks-image.toml'));
    const config = readFileSync(GITLEAKS_CONFIG_FILE, 'utf8');
    expect(config).toMatch(/^\[extend\]\r?\nuseDefault = true\r?$/m);
    // No rule, allow-list or path exception lives in the config: exceptions are IMAGE_SCAN_ALLOW_LIST only.
    expect(config.split(/\r?\n/).filter((line) => /^\s*\[/.test(line))).toEqual(['[extend]']);
    const ci = readFileSync(join(findRepoRoot(), '.github/workflows/ci.yml'), 'utf8');
    expect(/^\s+GITLEAKS_IMAGE: (\S+)$/m.exec(ci)?.[1]).toBe(GITLEAKS_IMAGE);
  });
});
