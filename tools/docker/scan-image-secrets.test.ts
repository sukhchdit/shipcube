/**
 * Pure parts of tools/docker/scan-image-secrets.mjs (TASK-014, AT-US-004-02). The Docker part (docker save, Gitleaks
 * per layer) runs in tests/compose/images.stack.test.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { describe, expect, it } from '@jest/globals';

import { findRepoRoot } from '../test-support/process.js';
import {
  confinedPath,
  decompressLayer,
  formatFindings,
  GITLEAKS_IMAGE,
  gitleaksArgs,
  gitleaksFindings,
  layerDigest,
  layersFromManifest,
  parseTar,
  paxPath,
  scanHistory,
  tarNumber,
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

  it('runs Gitleaks offline, read-only, redacted, with the CI pin', () => {
    const args = gitleaksArgs('/w/layer-0', '/w/reports', 'layer-0.json');
    expect(args.slice(0, 4)).toEqual(['run', '--rm', '--network', 'none']);
    expect(args).toContain('/w/layer-0:/scan:ro');
    expect(args).toContain('--redact');
    expect(args).toContain('--ignore-gitleaks-allow');
    const ci = readFileSync(join(findRepoRoot(), '.github/workflows/ci.yml'), 'utf8');
    expect(/^\s+GITLEAKS_IMAGE: (\S+)$/m.exec(ci)?.[1]).toBe(GITLEAKS_IMAGE);
  });
});
