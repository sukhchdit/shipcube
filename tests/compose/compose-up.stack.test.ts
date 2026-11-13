/**
 * Compose stack suite (TASK-014; US-003, US-049, NFR-OPS-001, SEC-TC-34 extended, D-ARCH-100, D-TASK017-01 (7);
 * platform.md §2.1-§2.5). Opt-in: `npm run test:stack -- tests/compose/compose-up` (Docker Desktop required; lane B,
 * under the host docker lock). Every run uses its own Compose project (`t014-<random>`) and removes it with `down -v`.
 * The host ports of compose.yaml are fixed, so the developer's own stack must be down while this suite runs.
 *
 * Order matters (one file, run in band): AT-US-003-01 starts the stack, the read-only checks use it, AT-US-003-02 and
 * -03 restart and reset it, AT-US-003-04 runs last on a separate project with a scratch migration override.
 */
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { readCompose, serviceEnvironment } from '../../tools/compose/compose-file.js';
import {
  ComposeStack,
  docker,
  http,
  httpsStatusInNetwork,
  referenceDatasetNames,
  ROOT,
  tryHttp,
  uniqueProject,
  waitFor,
} from './helpers/stack.js';

// The S3 SDK is a dependency of apps/api (the presigner the api itself uses), loaded from that workspace at run time.
// Only apps/api/src/platform/storage may import the SDK (D-ARCH-097, PR30-SEC-08), so the suite types the two members it
// uses locally instead of importing the SDK's types.
interface S3Sdk {
  readonly S3Client: new (config: {
    endpoint: string;
    region: string;
    forcePathStyle: boolean;
    credentials: { accessKeyId: string; secretAccessKey: string };
  }) => { destroy(): void };
  readonly GetObjectCommand: new (input: {
    Bucket: string;
    Key: string;
    ResponseContentType: string;
    ResponseContentDisposition: string;
  }) => object;
}
interface Presigner {
  readonly getSignedUrl: (client: object, command: object, options: { expiresIn: number }) => Promise<string>;
}
const apiRequire = createRequire(join(ROOT, 'apps/api/package.json'));
const { GetObjectCommand, S3Client } = apiRequire('@aws-sdk/client-s3') as S3Sdk;
const { getSignedUrl } = apiRequire('@aws-sdk/s3-request-presigner') as Presigner;

const UP_BUDGET_S = 180;
const stack = new ComposeStack(uniqueProject());
const composeFile = readCompose(ROOT);
const envOf = (service: string): Record<string, string> => serviceEnvironment(ROOT, composeFile, service);
/** Local-only values that must never appear in a log (the values themselves are never printed). */
const LOCAL_SECRETS = [...Object.values(envOf('bootstrap')), ...Object.values(envOf('seed')), ...Object.values(envOf('api'))].filter(
  (value) => value.includes('local-only-'),
);

let edgeCa = '';

/** Up with --wait; on failure the message names service states only (logs can be read with `docker compose logs`). */
function upAndWait(target: ComposeStack, timeoutS = UP_BUDGET_S): { seconds: number; status: number | null; states: string } {
  const started = process.hrtime.bigint();
  const result = target.run(['up', '-d', '--wait', '--wait-timeout', String(timeoutS)], (timeoutS + 120) * 1000);
  const seconds = Number(process.hrtime.bigint() - started) / 1e9;
  const states = target
    .ps()
    .map((c) => `${c.Service}=${c.State}${c.Health ? `/${c.Health}` : ''}${c.State === 'exited' ? `(${String(c.ExitCode)})` : ''}`)
    .join(' ');
  return { seconds, status: result.status, states };
}

/** Exact row counts of every seeded table (audit, outbox and job tables excluded: they may change while idle). */
function seededRowCounts(target: ComposeStack): string {
  const tables = target
    .psql(
      "SELECT format('%I.%I', table_schema, table_name) FROM information_schema.tables WHERE table_type = 'BASE TABLE' " +
        "AND table_schema NOT IN ('pg_catalog', 'information_schema', 'audit') AND table_name !~ '^(audit|outbox|job)' ORDER BY 1",
    )
    .split('\n')
    .filter((line) => line !== '');
  if (tables.length === 0) return '';
  return target.psql(
    tables.map((table) => `SELECT '${table.replaceAll("'", "''")}', count(*) FROM ${table}`).join(' UNION ALL ') + ' ORDER BY 1',
  );
}

const naturalKeys = (target: ComposeStack): string =>
  [
    target.psql('SELECT dataset || $$@$$ || version FROM public.reference_dataset_versions ORDER BY 1'),
    target.psql('SELECT migration_name FROM public._prisma_migrations WHERE finished_at IS NOT NULL ORDER BY 1'),
  ].join('\n--\n');

beforeAll(() => {
  // Image build time is reported, not gated (A-039): only `up` is measured against NFR-OPS-001.
  const started = Date.now();
  const build = stack.run(['build'], 3_600_000);
  process.stdout.write(`[stack] image build ${String(Math.round((Date.now() - started) / 1000))} s (exit ${String(build.status)})\n`);
  expect(build.status).toBe(0);
}, 3_700_000);

afterAll(() => {
  stack.down();
}, 300_000);

describe('docker compose up (US-003, NFR-OPS-001)', () => {
  it('[AT-US-003-01] [NFR-OPS-001] cold start reaches healthy within 180 s and /health/ready answers 200 through the edge', async () => {
    const { seconds, status, states } = upAndWait(stack);
    process.stdout.write(`[stack] NFR-OPS-001 cold start (warm images): ${seconds.toFixed(1)} s\n`);
    expect({ status, states }).toEqual({ status: 0, states: expect.any(String) as unknown });
    expect(seconds).toBeLessThanOrEqual(UP_BUDGET_S);
    for (const oneShot of ['bootstrap', 'migrate', 'seed', 'storage-init', 'tls-init']) {
      expect(stack.ps().find((c) => c.Service === oneShot)).toMatchObject({ State: 'exited', ExitCode: 0 });
    }
    const ready = await waitFor(
      'edge /health/ready',
      async () => {
        const response = await tryHttp({ port: 8080, path: '/health/ready' });
        return response?.status === 200 ? response : undefined;
      },
      30_000,
    );
    expect(ready.status).toBe(200);
    edgeCa = stack.run(['exec', '-T', 'edge', 'cat', '/etc/nginx/certs/ca.crt'], 30_000).stdout;
    expect(edgeCa).toContain('-----BEGIN CERTIFICATE-----');
    // In-network: a host TLS-inspecting antivirus re-signs localhost certificates (helpers/stack.ts).
    expect(httpsStatusInNetwork(stack, 8443, '/health/live', edgeCa)).toBe(200);
  });

  it('[AT-US-049-02] every reference dataset registered now is present with one reference_dataset_versions row', () => {
    const counts = new Map(
      stack
        .psql('SELECT dataset, count(*) FROM public.reference_dataset_versions GROUP BY dataset')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => line.split('|') as [string, string]),
    );
    for (const dataset of referenceDatasetNames()) expect({ dataset, rows: counts.get(dataset) }).toEqual({ dataset, rows: '1' });
    expect(stack.logs('seed')).not.toMatch(/SEED_[A-Z_]+_REFUSED|Seed refused/);
  });

  it('[SEC-TC-34] the edge publishes on 127.0.0.1 only by default, and no other service binds a non-loopback address', () => {
    const publishers = stack
      .ps()
      .flatMap((c) =>
        (c.Publishers ?? []).filter((p) => p.PublishedPort > 0).map((p) => ({ service: c.Service, url: p.URL, port: p.PublishedPort })),
      );
    expect(
      publishers
        .filter((p) => p.service === 'edge')
        .map((p) => p.port)
        .sort(),
    ).toEqual([8080, 8443, 8444, 9000]);
    expect(publishers.filter((p) => p.url !== '127.0.0.1')).toEqual([]);
    expect(publishers.filter((p) => ['api', 'worker', 'rustfs', 'web', 'admin'].includes(p.service))).toEqual([]);
  });

  it('[platform.md §2.2] Valkey refuses the default user; the healthcheck user may only PING; api cannot run dangerous commands', () => {
    const cli = (...args: string[]): string => {
      const result = stack.run(['exec', '-T', 'redis', 'valkey-cli', '--no-auth-warning', ...args], 30_000);
      return `${result.stdout}${result.stderr}`.trim();
    };
    expect(cli('ping')).toMatch(/NOAUTH/);
    expect(cli('--user', 'default', '--pass', 'anything', 'ping')).toMatch(/WRONGPASS|disabled/i);
    const health = (...args: string[]): string => {
      const result = stack.run(
        [
          'exec',
          '-T',
          'redis',
          'sh',
          '-c',
          `valkey-cli --no-auth-warning --user healthcheck --pass "$REDIS_HEALTHCHECK_PASSWORD" ${args.join(' ')}`,
        ],
        30_000,
      );
      return `${result.stdout}${result.stderr}`.trim();
    };
    expect(health('ping')).toBe('PONG');
    expect(health('get', 'auth:probe')).toMatch(/NOPERM/);
    expect(health('info')).toMatch(/NOPERM/);
    const apiPassword = decodeURIComponent(new URL(envOf('api')['REDIS_URL'] ?? 'x://h').password);
    expect(cli('--user', 'api', '--pass', apiPassword, 'config', 'get', 'maxmemory-policy')).toMatch(/NOPERM/);
    expect(cli('--user', 'api', '--pass', apiPassword, 'set', 'bull:probe', '1')).toMatch(/NOPERM/);
    expect(cli('--user', 'api', '--pass', apiPassword, 'set', 'cache:t014-probe', '1')).toBe('OK');
  });

  it('[D-TASK017-01 (7)] the served OpenAPI document through the edge is byte-equal to the repository contract', async () => {
    const served = await http({ port: 8080, path: '/api/docs/openapi.yaml' });
    expect(served.status).toBe(200);
    expect(served.body.equals(readFileSync(join(ROOT, 'docs/03-architecture/api/openapi.yaml')))).toBe(true);
  });

  it('[sheet line 527] /metrics is 404 at the edge on every host port', async () => {
    expect((await http({ port: 8080, path: '/metrics' })).status).toBe(404);
    expect(httpsStatusInNetwork(stack, 8444, '/metrics', edgeCa)).toBe(404);
  });

  it('[D-ARCH-100] [PR30-SEC-08] the store vhost serves pre-signed GETs only, with nosniff, for the signed Host only', async () => {
    const rustfs = envOf('rustfs');
    const put = stack.run(
      [
        'run',
        '--rm',
        '--no-deps',
        '--entrypoint',
        '/bin/sh',
        'storage-init',
        '-c',
        'export AWS_ACCESS_KEY_ID="$RUSTFS_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$RUSTFS_SECRET_KEY" AWS_DEFAULT_REGION=us-east-1 HOME=/tmp; ' +
          "printf '%s' '%PDF-1.4 t014 probe' > /tmp/probe.pdf && " +
          'aws --endpoint-url http://rustfs:9000 s3api put-object --bucket documents --key t014/probe.pdf --body /tmp/probe.pdf --content-type application/pdf >/dev/null',
      ],
      120_000,
    );
    expect(put.status).toBe(0);
    const client = new S3Client({
      endpoint: envOf('api')['STORAGE_PUBLIC_ENDPOINT'] ?? '',
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: rustfs['RUSTFS_ACCESS_KEY'] ?? '', secretAccessKey: rustfs['RUSTFS_SECRET_KEY'] ?? '' },
    });
    const signed = new URL(
      await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'documents',
          Key: 't014/probe.pdf',
          ResponseContentType: 'application/pdf',
          ResponseContentDisposition: 'attachment; filename="probe.pdf"',
        }),
        { expiresIn: 300 },
      ),
    );
    expect(signed.host).toBe('localhost:9000');
    const path = `${signed.pathname}${signed.search}`;
    const get = await http({ port: 9000, path, headers: { Host: signed.host } });
    expect(get.status).toBe(200);
    expect(get.headers['content-type']).toBe('application/pdf');
    expect(get.headers['content-disposition']).toMatch(/^attachment/);
    expect(get.headers['x-content-type-options']).toBe('nosniff');
    expect(get.body.toString()).toBe('%PDF-1.4 t014 probe');
    for (const method of ['PUT', 'DELETE']) {
      const response = await http({ port: 9000, path, method, headers: { Host: signed.host } });
      expect({ method, status: [403, 405].includes(response.status), nosniff: response.headers['x-content-type-options'] }).toEqual({
        method,
        status: true,
        nosniff: 'nosniff',
      });
    }
    expect((await http({ port: 9000, path, headers: { Host: 'other.example:9000' } })).status).toBe(403);
    client.destroy();
  });

  it('[AT-US-003-02] a second up is idempotent: seeded row counts are unchanged', () => {
    const before = seededRowCounts(stack);
    const { status, states } = upAndWait(stack);
    expect({ status, states }).toEqual({ status: 0, states: expect.any(String) as unknown });
    expect(stack.ps().find((c) => c.Service === 'seed')).toMatchObject({ State: 'exited', ExitCode: 0 });
    expect(seededRowCounts(stack)).toBe(before);
  });

  it('[AT-US-003-03] down -v then up returns to a clean state with the same natural keys', () => {
    const keys = naturalKeys(stack);
    const counts = seededRowCounts(stack);
    expect(stack.down().status).toBe(0);
    const volumes = docker(['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${stack.project}`], { timeoutMs: 30_000 });
    expect({ status: volumes.status, volumes: volumes.stdout.trim() }).toEqual({ status: 0, volumes: '' });
    const { status, states } = upAndWait(stack);
    expect({ status, states }).toEqual({ status: 0, states: expect.any(String) as unknown });
    expect(naturalKeys(stack)).toBe(keys);
    expect(seededRowCounts(stack)).toBe(counts);
  });

  it('[AT-US-003-04] a failing migration stops the stack visibly: api never healthy, error in the logs, no secret values', () => {
    expect(stack.down().status).toBe(0);
    const scratch = mkdtempSync(join(tmpdir(), 't014-migrations-'));
    const failing = new ComposeStack(uniqueProject(), ['compose.yaml', join(scratch, 'compose.invalid-migration.yaml')]);
    try {
      // The repository migrations plus one that fails, mounted over the tooling image's copy for `migrate` only.
      const migrations = join(scratch, 'migrations');
      cpSync(join(ROOT, 'prisma/migrations'), migrations, { recursive: true });
      expect(readdirSync(migrations).some((entry) => /^\d{14}_/.test(entry))).toBe(true);
      const invalid = join(migrations, '29991231235959_t014_invalid');
      mkdirSync(invalid);
      writeFileSync(join(invalid, 'migration.sql'), 'SELECT * FROM t014_missing_table;\n');
      writeFileSync(
        join(scratch, 'compose.invalid-migration.yaml'),
        [
          'services:',
          '  migrate:',
          '    volumes:',
          '      - type: bind',
          `        source: ${migrations.replaceAll('\\', '/')}`,
          '        target: /app/prisma/migrations',
          '        read_only: true',
          '',
        ].join('\n'),
      );
      const { status } = upAndWait(failing, 120);
      expect(status).not.toBe(0);
      const states = failing.ps();
      expect(states.find((c) => c.Service === 'migrate')).toMatchObject({ State: 'exited' });
      expect(states.find((c) => c.Service === 'migrate')?.ExitCode).not.toBe(0);
      for (const service of ['seed', 'api', 'worker']) {
        const container = states.find((c) => c.Service === service);
        expect({ service, healthy: container?.Health === 'healthy' || container?.State === 'running' }).toEqual({
          service,
          healthy: false,
        });
      }
      const logs = failing.logs('migrate');
      expect(logs).toMatch(/t014_missing_table|t014_invalid/);
      expect(LOCAL_SECRETS.filter((secret) => logs.includes(secret))).toEqual([]);
      expect(logs).not.toMatch(/postgres(?:ql)?:\/\/[^\s/]*:[^\s/]*@/);
    } finally {
      failing.down();
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
