/**
 * Lane A static checks of the Compose stack (TASK-014; platform.md §2.1-§2.5; WAVE-00 sheet lines 512-547). No Docker:
 * compose.yaml and compose.debug.yaml are read with the YAML subset parser (tools/ci/yaml-subset.mjs), the env files
 * with tools/config/env-file.ts. The stack suite (tests/compose/*.stack.test.ts) proves the same rules at run time.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { parseSecretRef } from '@platform/config';

import { findRepoRoot } from '../test-support/process.js';
import {
  dependsOn,
  environmentOf,
  imagesOf,
  inlineDockerfileBases,
  isBuilt,
  parseCompose,
  publishedPorts,
  readCompose,
  serviceEnvironment,
  stringsOf,
} from './compose-file.js';

const root = findRepoRoot();
const read = (file: string): string => readFileSync(join(root, file), 'utf8');
const compose = readCompose(root);
const debug = readCompose(root, 'compose.debug.yaml');
const service = (name: string) => compose.services[name] ?? {};
const envOf = (name: string): Record<string, string> => serviceEnvironment(root, compose, name);

const DIGEST_REF = /^[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9._-]+@sha256:[0-9a-f]{64}$/;
const SERVICES = [
  'postgres',
  'redis',
  'rustfs',
  'storage-init',
  'mailpit',
  'tls-init',
  'bootstrap',
  'migrate',
  'seed',
  'api',
  'worker',
  'web',
  'admin',
  'edge',
];
const ONE_SHOTS = ['storage-init', 'tls-init', 'bootstrap', 'migrate', 'seed'];

/** Text files of the local stack (compose files, env files, scripts, edge configuration). */
const listFiles = (dir: string): string[] =>
  readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`],
  );
const STACK_FILES = ['compose.yaml', 'compose.debug.yaml', 'compose.env', ...listFiles('infra/local')];

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
const passwordOf = (url: string | undefined): string => decodeURIComponent(new URL(url ?? 'x://h').password);

describe('compose.yaml shape (TASK-014)', () => {
  it('both compose files parse in the YAML subset and define exactly the platform services and volumes', () => {
    expect(() => parseCompose(read('compose.yaml'))).not.toThrow();
    expect(() => parseCompose(read('compose.debug.yaml'))).not.toThrow();
    expect(Object.keys(compose.services).sort()).toEqual([...SERVICES].sort());
    expect([...compose.volumes].sort()).toEqual(['audit-anchors', 'edgecerts', 'pgdata', 'redisdata', 'rustfsdata']);
    expect(Object.keys(debug.services).sort()).toEqual(['api', 'rustfs', 'worker']);
  });

  it('[NFR-OPS-002] every third-party image is pinned name:tag@sha256, platform images are built shipcube-*:local', () => {
    for (const [name, image] of Object.entries(imagesOf(compose))) {
      if (isBuilt(service(name)))
        expect({ name, image }).toEqual({ name, image: expect.stringMatching(/^shipcube-[a-z-]+:local$/) as unknown });
      else expect({ name, image }).toEqual({ name, image: expect.stringMatching(DIGEST_REF) as unknown });
    }
    for (const [name, bases] of Object.entries(inlineDockerfileBases(compose))) {
      expect(bases.length).toBeGreaterThan(0);
      for (const base of bases) expect({ name, base }).toEqual({ name, base: expect.stringMatching(DIGEST_REF) as unknown });
    }
    expect(Object.keys(compose.services).filter((name) => service(name)['image'] === undefined)).toEqual([]);
  });

  it('[PR30-SEC-08] rustfs uses the digest the storage contract suite pins (apps/api/src/platform/storage/tests/rustfs.ts)', () => {
    const pinned = /export const RUSTFS_IMAGE = '([^']+)'/.exec(read('apps/api/src/platform/storage/tests/rustfs.ts'))?.[1];
    expect(pinned).toMatch(/^rustfs\/rustfs:1\.0\.4@sha256:[0-9a-f]{64}$/);
    expect(service('rustfs')['image']).toBe(pinned);
  });

  it('postgres and valkey use the Testcontainers harness digests; the edge uses the web/admin nginx base', () => {
    const harness = (JSON.parse(read('tools/quality/suite-runners.json')) as { testcontainers_images: string[] }).testcontainers_images;
    expect(harness).toContain(service('postgres')['image']);
    expect(harness).toContain(service('redis')['image']);
    const nginx = /^FROM (nginxinc\/nginx-unprivileged:\S+) AS runtime$/m.exec(read('apps/web/Dockerfile'))?.[1];
    expect(nginx).toMatch(DIGEST_REF);
    expect(read('apps/admin/Dockerfile')).toContain(`FROM ${nginx ?? ''} AS runtime`);
    expect(service('edge')['image']).toBe(nginx);
  });

  it('[SEC-TC-34] host ports bind 127.0.0.1; the edge binds ${EDGE_BIND}, which defaults to 127.0.0.1', () => {
    for (const file of [compose, debug]) {
      for (const [name, svc] of Object.entries(file.services)) {
        for (const port of publishedPorts(svc))
          expect({ name, port }).toEqual({ name, port: expect.stringMatching(/^127\.0\.0\.1:\d+:\d+$/) as unknown });
        if (name !== 'edge') expect(stringsOf(svc, 'ports').every((port) => port.startsWith('127.0.0.1:'))).toBe(true);
      }
    }
    expect(stringsOf(service('edge'), 'ports')).toEqual(
      ['8080', '8443', '8444', '9000'].map((port) => `\${EDGE_BIND:-127.0.0.1}:${port}:${port}`),
    );
    expect(publishedPorts(service('edge'), { EDGE_BIND: '0.0.0.0' })[0]).toBe('0.0.0.0:8080:8080');
  });

  it('api, worker, rustfs, web and admin publish no host port; the RustFS console port 9001 is never published', () => {
    for (const name of ['api', 'worker', 'rustfs', 'web', 'admin', ...ONE_SHOTS])
      expect({ name, ports: stringsOf(service(name), 'ports') }).toEqual({ name, ports: [] });
    for (const file of [compose, debug]) {
      for (const svc of Object.values(file.services)) expect(publishedPorts(svc).filter((port) => /:9001$/.test(port))).toEqual([]);
    }
    expect(environmentOf(service('rustfs'))['RUSTFS_CONSOLE_ENABLE']).toBe('false');
  });

  it('compose.debug.yaml publishes api:3000, worker:9464 and the RustFS S3 API on 127.0.0.1 only', () => {
    expect(publishedPorts(debug.services['api'] ?? {})).toEqual(['127.0.0.1:3000:3000']);
    expect(publishedPorts(debug.services['worker'] ?? {})).toEqual(['127.0.0.1:9464:9464']);
    expect(publishedPorts(debug.services['rustfs'] ?? {})).toEqual(['127.0.0.1:9002:9000']);
  });

  it('[platform.md §2.4] start order: postgres -> bootstrap -> migrate -> seed -> api/worker -> edge', () => {
    expect(dependsOn(service('bootstrap'))).toEqual({ postgres: 'service_healthy' });
    expect(dependsOn(service('migrate'))).toEqual({ bootstrap: 'service_completed_successfully' });
    expect(dependsOn(service('seed'))).toEqual({ migrate: 'service_completed_successfully' });
    const runtime = {
      migrate: 'service_completed_successfully',
      seed: 'service_completed_successfully',
      redis: 'service_healthy',
      'storage-init': 'service_completed_successfully',
    };
    expect(dependsOn(service('api'))).toEqual(runtime);
    expect(dependsOn(service('worker'))).toEqual({ ...runtime, mailpit: 'service_healthy' });
    expect(dependsOn(service('storage-init'))).toEqual({ rustfs: 'service_healthy' });
    expect(dependsOn(service('edge'))).toEqual({
      'tls-init': 'service_completed_successfully',
      web: 'service_healthy',
      admin: 'service_healthy',
      api: 'service_healthy',
    });
  });

  it('api and worker: init, read-only root, tmpfs /tmp, audit-anchors read-only in the api and writable in the worker only', () => {
    for (const name of ['api', 'worker']) {
      expect([service(name)['init'], service(name)['read_only'], stringsOf(service(name), 'tmpfs')]).toEqual(['true', 'true', ['/tmp']]);
      expect(stringsOf(service(name), 'cap_drop')).toEqual(['ALL']);
    }
    expect(stringsOf(service('api'), 'volumes')).toEqual(['audit-anchors:/data/audit-anchors:ro']);
    expect(stringsOf(service('worker'), 'volumes')).toEqual(['audit-anchors:/data/audit-anchors']);
    const mounting = Object.keys(compose.services).filter((name) =>
      stringsOf(service(name), 'volumes').some((volume) => volume.startsWith('audit-anchors:')),
    );
    expect(mounting.sort()).toEqual(['api', 'worker']);
  });

  it('one-shots and nginx services run with a read-only root filesystem and the tmpfs mounts they need', () => {
    for (const name of ['bootstrap', 'migrate', 'seed', 'storage-init', 'tls-init']) {
      expect({
        name,
        readOnly: service(name)['read_only'],
        tmpfs: stringsOf(service(name), 'tmpfs'),
        restart: service(name)['restart'],
      }).toEqual({
        name,
        readOnly: 'true',
        tmpfs: ['/tmp'],
        restart: 'no',
      });
    }
    for (const name of ['web', 'admin', 'edge']) {
      expect({ name, readOnly: service(name)['read_only'], tmpfs: stringsOf(service(name), 'tmpfs') }).toEqual({
        name,
        readOnly: 'true',
        tmpfs: ['/tmp', '/var/cache/nginx', '/var/run'],
      });
    }
  });

  it('the tooling one-shots share one image and run bootstrap, migrate and seed', () => {
    for (const name of ['bootstrap', 'migrate', 'seed']) {
      expect([service(name)['image'], stringsOf(service(name), 'command')]).toEqual(['shipcube-tooling:local', [name]]);
    }
  });

  it('the edge mounts its configuration and the certificate volume read-only', () => {
    expect(stringsOf(service('edge'), 'volumes')).toEqual(['./infra/local/edge:/etc/nginx/conf.d:ro', 'edgecerts:/etc/nginx/certs:ro']);
    expect(environmentOf(service('edge'))['EDGE_APP_ENV']).toBe('${EDGE_APP_ENV:-local}');
  });
});

describe('Valkey ACL (platform.md §2.2 redis row; SEC-P3-08 item 2, SEC-P3-12 item 4)', () => {
  const acl = read('infra/local/valkey/users.acl').trimEnd().split('\n');
  const HASH = '#([0-9a-f]{64})';

  it('runs with the ACL file (mounted read-only), AOF and noeviction; no shared requirepass', () => {
    expect(stringsOf(service('redis'), 'command')).toEqual([
      'valkey-server',
      '--aclfile',
      '/etc/valkey/users.acl',
      '--appendonly',
      'yes',
      '--maxmemory-policy',
      'noeviction',
    ]);
    expect(stringsOf(service('redis'), 'volumes')).toContain('./infra/local/valkey/users.acl:/etc/valkey/users.acl:ro');
    expect(read('compose.yaml')).not.toMatch(/requirepass/);
  });

  it('defines exactly default (off), api, worker and healthcheck with the platform.md rules', () => {
    expect(acl).toHaveLength(4);
    expect(acl[0]).toBe('user default off resetpass resetkeys resetchannels -@all');
    expect(acl[1]).toMatch(
      new RegExp(`^user api on ${HASH} ~auth:\\* ~rl:\\* ~cache:\\* ~carrier:\\* ~sse:\\* &sse:\\* \\+@all -@dangerous$`),
    );
    expect(acl[2]).toMatch(new RegExp(`^user worker on ${HASH} ~bull:\\* ~carrier:\\* ~audit:\\* ~cache:\\* \\+@all -@dangerous \\+info$`));
    expect(acl[3]).toMatch(new RegExp(`^user healthcheck on ${HASH} -@all \\+ping$`));
    expect(acl.join('\n')).not.toMatch(/nopass|\s>/);
  });

  it('every password hash is the SHA-256 of the local-only password in the env files (no plaintext duplicate)', () => {
    const hashOf = (user: string): string | undefined =>
      new RegExp(`^user ${user} on ${HASH}`).exec(acl.find((line) => line.startsWith(`user ${user} `)) ?? '')?.[1];
    expect(hashOf('api')).toBe(sha256(passwordOf(envOf('api')['REDIS_URL'])));
    expect(hashOf('worker')).toBe(sha256(passwordOf(envOf('worker')['REDIS_URL'])));
    expect(hashOf('healthcheck')).toBe(sha256(envOf('redis')['REDIS_HEALTHCHECK_PASSWORD'] ?? ''));
    expect(read('infra/local/valkey/users.acl')).not.toMatch(/local-only/);
  });

  it('the health check authenticates as the ping-only healthcheck user', () => {
    const healthcheck = (service('redis')['healthcheck'] ?? {}) as Record<string, unknown>;
    expect(healthcheck['test']).toBe(
      'valkey-cli --user healthcheck --pass "$$REDIS_HEALTHCHECK_PASSWORD" --no-auth-warning ping | grep -qx PONG',
    );
  });
});

describe('RustFS and storage-init (D-ARCH-100 item 2; platform.md §2.2 rustfs paragraph)', () => {
  it('the RustFS root credentials are the values the api/worker STORAGE_*_REF references resolve to', () => {
    const rustfs = envOf('rustfs');
    for (const name of ['api', 'worker']) {
      const env = envOf(name);
      const resolve = (refKey: string): string | undefined => {
        const parsed = parseSecretRef(env[refKey] ?? '');
        return parsed.ok && parsed.value.provider === 'env' ? env[parsed.value.locator] : undefined;
      };
      expect(resolve('STORAGE_ACCESS_KEY_ID_REF')).toBe(rustfs['RUSTFS_ACCESS_KEY']);
      expect(resolve('STORAGE_SECRET_ACCESS_KEY_REF')).toBe(rustfs['RUSTFS_SECRET_KEY']);
    }
  });

  it('storage-init creates exactly the platform.md bucket list (no audit-anchors bucket) and treats existing as success', () => {
    const script = read('infra/local/storage-init/storage-init.sh');
    expect(/^for bucket in (.+); do$/m.exec(script)?.[1]?.split(' ')).toEqual([
      'documents',
      'raw-carrier-payloads',
      'exports',
      'audit-archive',
      'web-assets',
    ]);
    const code = script
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    expect(code).not.toMatch(/audit-anchors/);
    expect(script).toMatch(/head-bucket/);
    expect(script).toMatch(/BucketAlreadyOwnedByYou/);
    expect(script).toMatch(/put-bucket-versioning --bucket "\$bucket" --versioning-configuration Status=Enabled/);
    const env = envOf('api');
    expect([env['STORAGE_BUCKET_DOCUMENTS'], env['STORAGE_BUCKET_RAW_CARRIER_PAYLOADS']]).toEqual(['documents', 'raw-carrier-payloads']);
  });

  it('STORAGE_PUBLIC_ENDPOINT is the edge store vhost (localhost:9000) and STORAGE_ENDPOINT the in-network RustFS', () => {
    const env = envOf('api');
    expect([env['STORAGE_ENDPOINT'], env['STORAGE_PUBLIC_ENDPOINT']]).toEqual(['http://rustfs:9000', 'http://localhost:9000']);
  });
});

describe('tooling one-shot preflight (PR3-SEC-14)', () => {
  const entrypoint = read('tools/docker/tooling-entrypoint.sh');
  const branch = (name: string): string => new RegExp(`^  ${name}\\)\\n([\\s\\S]*?)\\n    ;;`, 'm').exec(entrypoint)?.[1] ?? '';

  it('checks DATABASE_BOOTSTRAP_URL before bootstrap and DATABASE_MIGRATOR_URL before migrate and seed', () => {
    expect(entrypoint).toContain('node "$TSX" --conditions=@platform/source tools/db/check-tooling-env.ts "$1"');
    expect(branch('bootstrap').trim().split('\n')[0]?.trim()).toBe('check_env DATABASE_BOOTSTRAP_URL');
    expect(branch('migrate').trim().split('\n')[0]?.trim()).toBe('check_env DATABASE_MIGRATOR_URL');
    expect(branch('seed').trim().split('\n')[0]?.trim()).toBe('check_env DATABASE_MIGRATOR_URL');
    expect(branch('prisma-version')).not.toContain('check_env');
  });

  it('the tooling image ships the checker', () => {
    expect(read('prisma/Dockerfile')).toMatch(/^COPY tools\/db\/bootstrap\.ts tools\/db\/check-tooling-env\.ts .* tools\/db\/$/m);
  });
});

describe('secret hygiene of the stack files', () => {
  it('the local-only Compose environment and stack configuration are outside every image build context', () => {
    const ignored = read('.dockerignore').split(/\r?\n/);
    expect(['compose.env', 'compose*.yaml', 'infra/local'].filter((entry) => !ignored.includes(entry))).toEqual([]);
  });

  it('no npx anywhere in the stack files', () => {
    for (const file of STACK_FILES) expect({ file, npx: /\bnpx\b/.test(read(file)) }).toEqual({ file, npx: false });
  });

  it('local-only values appear only in env files; no credential-shaped literal elsewhere', () => {
    const SHAPES = [
      /\/\/[^/:@\s]+:[^@\s]+@/,
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
      /\bAKIA[0-9A-Z]{16}\b/,
      /\b(?:sk|rk|pk)_(?:live|test)_/,
      /\bwhsec_/,
    ];
    for (const file of STACK_FILES.filter((name) => !name.endsWith('.env'))) {
      const text = read(file);
      expect({ file, localOnly: /local-only-[a-z]/.test(text) }).toEqual({ file, localOnly: false });
      expect({ file, shapes: SHAPES.filter((shape) => shape.test(text)).map(String) }).toEqual({ file, shapes: [] });
    }
  });
});

describe('edge configuration (sheet lines 516, 527; platform.md §2.2 edge row, §2.5)', () => {
  const EDGE = 'infra/local/edge';
  const confs = readdirSync(join(root, EDGE)).filter((name) => name.endsWith('.conf'));
  const all = [...confs, ...readdirSync(join(root, EDGE)).filter((name) => name.endsWith('.inc'))]
    .map((name) => read(`${EDGE}/${name}`))
    .join('\n');

  /** Bodies of every `server { ... }` block (brace matching; the files hold no braces inside strings). */
  const serverBlocks = (text: string): string[] => {
    const blocks: string[] = [];
    for (const match of text.matchAll(/^\s*server\s*\{/gm)) {
      let depth = 0;
      let end = match.index;
      for (let i = match.index; i < text.length; i += 1) {
        if (text[i] === '{') depth += 1;
        else if (text[i] === '}' && (depth -= 1) === 0) {
          end = i;
          break;
        }
      }
      blocks.push(text.slice(match.index, end + 1));
    }
    return blocks;
  };

  it('every server logs with the edge format, which carries no Cookie, Authorization or query string', () => {
    const blocks = confs.flatMap((name) => serverBlocks(read(`${EDGE}/${name}`)));
    expect(blocks.length).toBeGreaterThanOrEqual(4);
    for (const block of blocks) expect(block).toContain('access_log /dev/stdout edge;');
    const format = /log_format edge[\s\S]*?';\n/.exec(all)?.[0] ?? '';
    expect(format).not.toBe('');
    expect(format).not.toMatch(
      /\$http_cookie|\$http_authorization|\$cookie_|\$request_uri|\$request\b|\$args|\$query_string|\$http_x_mock/,
    );
  });

  it('api upstream re-resolves Docker DNS; /metrics is 404; SSE is unbuffered; X-Forwarded-For/Proto are set', () => {
    expect(all).toContain('resolver 127.0.0.11 valid=5s');
    expect(all).toMatch(/server api:3000 resolve/);
    expect(all).toMatch(/location = \/metrics \{\s*return 404;\s*\}/);
    expect(all).toMatch(/location ~ \^\/api\/v1\/quotes\/\[\^\/\]\+\/stream\$ \{[^}]*proxy_buffering off;/);
    const proxy = read(`${EDGE}/api-proxy.inc`);
    expect(proxy).toContain('proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;');
    expect(proxy).toContain('proxy_set_header X-Forwarded-Proto $scheme;');
  });

  it('X-Mock-Scenario reaches the api only for EDGE_APP_ENV=local (fail closed otherwise)', () => {
    expect(read(`${EDGE}/api-proxy.inc`)).toContain('proxy_set_header X-Mock-Scenario $edge_mock_scenario;');
    expect(all).toMatch(/map \$edge_app_env \$edge_mock_scenario \{\s*default "";\s*local\s+\$http_x_mock_scenario;\s*\}/);
    expect(read(`${EDGE}/templates/edge-env.conf.template`)).toMatch(/default "\$\{EDGE_APP_ENV\}";/);
    expect(read(`${EDGE}/00-edge.conf`)).toContain('include /tmp/edge-env.conf;');
    expect(environmentOf(service('edge'))['NGINX_ENVSUBST_FILTER']).toBe('^EDGE_');
  });

  it('the store vhost passes Host through, forwards GET/HEAD only, adds nosniff and refuses other hosts', () => {
    const storage = read(`${EDGE}/storage.conf`);
    const [fallback = '', vhost = ''] = serverBlocks(storage);
    expect(fallback).toMatch(/listen 9000 default_server;[\s\S]*return 403;/);
    expect(vhost).toMatch(/server_name localhost;/);
    expect(vhost).toContain('proxy_set_header Host $http_host;');
    expect(vhost).toMatch(/if \(\$request_method !~ \^\(\?:GET\|HEAD\)\$\) \{\s*return 405;\s*\}/);
    expect(vhost).toContain('add_header X-Content-Type-Options "nosniff" always;');
    expect(vhost).toContain('proxy_pass http://edge_store;');
  });

  it('TLS comes from the tls-init volume; no key or certificate is committed', () => {
    expect(read(`${EDGE}/tls.inc`)).toMatch(
      /ssl_certificate \/etc\/nginx\/certs\/edge\.crt;\s*ssl_certificate_key \/etc\/nginx\/certs\/edge\.key;/,
    );
    expect(STACK_FILES.filter((file) => /\.(?:pem|key|crt)$/.test(file))).toEqual([]);
    expect(read('infra/local/tls-init/tls-init.sh')).toContain('chown 101:101');
  });
});
