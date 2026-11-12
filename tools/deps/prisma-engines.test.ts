/**
 * SEC-TC-64 (TASK-003 part; ADR-0023 am. J item 2, D-ARCH-041, PR1-SEC-02): the Prisma schema engine is pinned by
 * tools/deps/prisma-engines.json and placed on disk only by tools/deps/prisma-engines.mjs.
 *
 * Test seams. Cases (i), (iii) and (v) run `ensureEngine`/`run` in-process against a temporary engines directory, a
 * temporary manifest and an injected transport. The transport replaces the HTTPS client, never the origin: the URL
 * is still built from the constant ENGINE_ORIGIN, the seam is a function parameter that no production caller passes,
 * and nothing reads it from the environment or configuration. Making the origin "unreachable" this way needs no real
 * network and no DNS manipulation, which keeps the unit lane offline (TEST-STRATEGY §10.2). Case (ii) runs the real
 * entry scripts as child processes. Case (iv) runs the real Prisma CLI through the wrapper in --verify-only mode
 * (hash compare, never the network) against the real engine installed by `npm run deps:rebuild`.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import {
  ENGINE_ORIGIN,
  EngineError,
  FETCH_RETRIES,
  FORBIDDEN_ENGINE_ENV,
  MAX_BINARY_BYTES,
  ensureEngine,
  engineFileName,
  engineUrl,
  fetchFromOrigin,
  forbiddenEnv,
  locateInstall,
  prismaChildEnv,
  readManifest,
  recordHashes,
  reverifyEngine,
  run,
  type Transport,
} from './prisma-engines.mjs';
import { PRISMA_TREE_LOCK, withFileLock } from '../test-support/fs-lock.js';
import { findRepoRoot, runNode } from '../test-support/process.js';

const repoRoot = findRepoRoot();
const realManifestPath = join(repoRoot, 'tools', 'deps', 'prisma-engines.json');
const VERSION = 'd1b3f377ca835d73fd50954a5e22128b9ebdd6b8';
const TARGET = 'debian-openssl-3.0.x';
const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

const work = mkdtempSync(join(tmpdir(), 'sec-tc-64-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** A fake engine binary, served by a fake origin. */
const binary = randomBytes(4096);
const gz = gzipSync(binary);
let sequence = 0;

interface Sandbox {
  enginesDir: string;
  manifestPath: string;
  install: { enginesDir: string; enginesVersion: string; getPlatformEntry: string };
}

function sandbox(manifest: { enginesVersion?: string; source?: string; sha256?: string } = {}): Sandbox {
  sequence += 1;
  const dir = join(work, `case-${sequence}`);
  const enginesDir = join(dir, 'engines');
  mkdirSync(enginesDir, { recursive: true });
  const manifestPath = join(dir, 'prisma-engines.json');
  writeFileSync(
    manifestPath,
    JSON.stringify({
      enginesVersion: manifest.enginesVersion ?? VERSION,
      source: manifest.source ?? ENGINE_ORIGIN,
      schemaEngine: { [TARGET]: { sha256: manifest.sha256 ?? sha256(binary) }, windows: { sha256: sha256(binary) } },
    }),
  );
  return { enginesDir, manifestPath, install: { enginesDir, enginesVersion: VERSION, getPlatformEntry: 'unused-in-tests' } };
}

/** Records the URLs requested and serves the fake engine for the target URL. */
function origin(overrides: { gz?: Buffer; shaText?: string } = {}) {
  const requested: string[] = [];
  const transport: Transport = async (url) => {
    requested.push(url);
    if (url === engineUrl(VERSION, TARGET)) return { status: 200, body: overrides.gz ?? gz };
    if (url === `${engineUrl(VERSION, TARGET)}.sha256`)
      return { status: 200, body: Buffer.from(overrides.shaText ?? `${sha256(overrides.gz ?? gz)}  schema-engine.gz\n`) };
    return { status: 404, body: Buffer.alloc(0) };
  };
  return { transport, requested };
}

const engineFiles = (dir: string) => readdirSync(dir).filter((name) => name.startsWith('schema-engine'));
const noSleep = async () => undefined;

describe('pinned Prisma schema engine (SEC-TC-64, ADR-0023 am. J item 2)', () => {
  it('[SEC-TC-64] the committed manifest pins the installed engines version, the fixed origin and both repository targets', () => {
    const manifest = readManifest(realManifestPath);
    expect(manifest.source).toBe('https://binaries.prisma.sh/all_commits/');
    expect(manifest.enginesVersion).toBe(locateInstall(repoRoot).enginesVersion);
    expect(Object.keys(manifest.schemaEngine).sort()).toEqual(['debian-openssl-3.0.x', 'windows']);
  });

  it.each([
    ['not JSON', '{', /cannot read the engine manifest/],
    ['an array', '[]', /must be a JSON object/],
    [
      'an unknown key',
      JSON.stringify({ enginesVersion: VERSION, source: ENGINE_ORIGIN, schemaEngine: {}, mirror: 'x' }),
      /unknown keys: mirror/,
    ],
    ['a short enginesVersion', JSON.stringify({ enginesVersion: 'd1b3', source: ENGINE_ORIGIN, schemaEngine: {} }), /40-character/],
    [
      'no schemaEngine object',
      JSON.stringify({ enginesVersion: VERSION, source: ENGINE_ORIGIN, schemaEngine: [] }),
      /keyed by binary target/,
    ],
    ['no target', JSON.stringify({ enginesVersion: VERSION, source: ENGINE_ORIGIN, schemaEngine: {} }), /lists no binary target/],
    [
      'an uppercase hash',
      JSON.stringify({ enginesVersion: VERSION, source: ENGINE_ORIGIN, schemaEngine: { windows: { sha256: 'A'.repeat(64) } } }),
      /64 lowercase hex/,
    ],
    [
      'a target without a hash',
      JSON.stringify({ enginesVersion: VERSION, source: ENGINE_ORIGIN, schemaEngine: { windows: null } }),
      /64 lowercase hex/,
    ],
  ])('[SEC-TC-64] refuses a manifest with %s', (_label, text, message) => {
    const path = join(work, `manifest-${sequence++}.json`);
    writeFileSync(path, text);
    expect(() => readManifest(path)).toThrow(message);
  });

  it('[SEC-TC-64] fetches from the fixed origin, checks the transport hash and the manifest, and writes the engine atomically', async () => {
    const box = sandbox();
    const { transport, requested } = origin();
    const result = await ensureEngine({ ...box, target: TARGET, transport, env: {} });
    expect(result).toEqual({ path: join(box.enginesDir, engineFileName(TARGET)), mode: 'fetched', target: TARGET, sha256: sha256(binary) });
    expect(requested.sort()).toEqual([engineUrl(VERSION, TARGET), `${engineUrl(VERSION, TARGET)}.sha256`]);
    expect(requested.every((url) => url.startsWith(ENGINE_ORIGIN))).toBe(true);
    expect(engineFiles(box.enginesDir)).toEqual([engineFileName(TARGET)]);
    expect(sha256(readFileSync(result.path))).toBe(sha256(binary));
  });

  it('[SEC-TC-64] uses a present engine whose hash matches the manifest without any network call (offline mode)', async () => {
    const box = sandbox();
    writeFileSync(join(box.enginesDir, engineFileName(TARGET)), binary);
    const { transport, requested } = origin();
    const result = await ensureEngine({ ...box, target: TARGET, transport, env: {}, verifyOnly: true });
    expect(result.mode).toBe('cached');
    expect(requested).toEqual([]);
  });

  it('[SEC-TC-64] (i) an altered manifest hash exits 1 and leaves no schema-engine* file, not even a previously present one', async () => {
    const box = sandbox({ sha256: sha256('something else') });
    writeFileSync(join(box.enginesDir, engineFileName(TARGET)), binary);
    writeFileSync(join(box.enginesDir, `${engineFileName(TARGET)}.partial-1-ab`), 'left over');
    const { transport } = origin();
    const errors: string[] = [];
    const code = await run([], { ...box, target: TARGET, transport, env: {} }, { out: () => undefined, err: (text) => errors.push(text) });
    expect(code).toBe(1);
    expect(errors.join('')).toMatch(new RegExp(`expected ${sha256('something else')}, actual ${sha256(binary)}`));
    expect(engineFiles(box.enginesDir)).toEqual([]);
  });

  it('[SEC-TC-64] (i) a transport hash mismatch and a non-gzip body both fail closed with nothing left behind', async () => {
    const box = sandbox();
    await expect(
      ensureEngine({ ...box, target: TARGET, transport: origin({ shaText: '0'.repeat(64) }).transport, env: {} }),
    ).rejects.toThrow(/transport check failed/);
    const garbage = Buffer.from('not gzip');
    await expect(ensureEngine({ ...box, target: TARGET, transport: origin({ gz: garbage }).transport, env: {} })).rejects.toThrow(
      /cannot gunzip/,
    );
    expect(engineFiles(box.enginesDir)).toEqual([]);
  });

  it('[SEC-TC-64] a gzip that inflates beyond the cap fails closed with nothing left behind (PR5-SEC-06)', async () => {
    expect(MAX_BINARY_BYTES).toBe(256 * 1024 * 1024);
    const box = sandbox();
    writeFileSync(join(box.enginesDir, engineFileName(TARGET)), 'stale engine');
    const bomb = gzipSync(Buffer.alloc(64 * 1024));
    await expect(
      ensureEngine({ ...box, target: TARGET, transport: origin({ gz: bomb }).transport, env: {}, maxBinaryBytes: 4096 }),
    ).rejects.toThrow(/cannot gunzip/);
    expect(engineFiles(box.enginesDir)).toEqual([]);
    // Control: an engine exactly at the cap is accepted.
    const ok = await ensureEngine({ ...box, target: TARGET, transport: origin().transport, env: {}, maxBinaryBytes: binary.length });
    expect(ok.mode).toBe('fetched');
  });

  it.each(FORBIDDEN_ENGINE_ENV.map((name) => [name]))(
    '[SEC-TC-64] (ii) %s in the environment is refused before any network call',
    async (name) => {
      const box = sandbox();
      const { transport, requested } = origin();
      await expect(
        ensureEngine({ ...box, target: TARGET, transport, env: { [name.toLowerCase()]: 'https://engines.invalid' } }),
      ).rejects.toThrow(/refusing to run: engine-redirecting variable/);
      expect(requested).toEqual([]);
      expect(engineFiles(box.enginesDir)).toEqual([]);
    },
  );

  it('[SEC-TC-64] (ii) PRISMA_ENGINES_MIRROR makes deps:rebuild and the Prisma wrapper exit 1 before any step runs', () => {
    const env = { ...process.env, PRISMA_ENGINES_MIRROR: 'https://engines.invalid' };
    const rebuild = runNode([join(repoRoot, 'tools', 'deps', 'rebuild.mjs')], { cwd: repoRoot, env });
    expect(rebuild.status).toBe(1);
    expect(rebuild.stderr).toContain('refusing to run: engine-redirecting variable(s) set in the environment: PRISMA_ENGINES_MIRROR');
    expect(rebuild.stdout).not.toContain('[deps:rebuild] ');
    const wrapper = runNode([join(repoRoot, 'tools', 'deps', 'prisma-cli.mjs'), '--version'], { cwd: repoRoot, env });
    expect(wrapper.status).toBe(1);
    expect(wrapper.stderr).toContain('PRISMA_ENGINES_MIRROR');
    expect(wrapper.stdout).not.toContain('prisma');
  });

  it('[SEC-TC-64] (ii) PRISMA_SCHEMA_ENGINE_BINARY is tolerated only when it names the verified engine file itself', async () => {
    const box = sandbox();
    const dest = join(box.enginesDir, engineFileName(TARGET));
    writeFileSync(dest, binary);
    await expect(ensureEngine({ ...box, target: TARGET, env: { PRISMA_SCHEMA_ENGINE_BINARY: dest } })).resolves.toMatchObject({
      mode: 'cached',
    });
    await expect(ensureEngine({ ...box, target: TARGET, env: { PRISMA_SCHEMA_ENGINE_BINARY: join(work, 'evil') } })).rejects.toThrow(
      /PRISMA_SCHEMA_ENGINE_BINARY/,
    );
    expect(forbiddenEnv({ PRISMA_SCHEMA_ENGINE_BINARY: dest, HOME: '/x' }, dest)).toEqual([]);
  });

  it('[SEC-TC-64] (iii) an empty engine directory and an unreachable origin fail closed after 3 retries per file', async () => {
    const box = sandbox();
    const requested: string[] = [];
    const unreachable: Transport = async (url) => {
      requested.push(url);
      throw Object.assign(new Error(`connect ECONNREFUSED ${new URL(url).host}`), { code: 'ECONNREFUSED' });
    };
    const errors: string[] = [];
    const code = await run(
      [],
      { ...box, target: TARGET, transport: unreachable, env: {}, sleep: noSleep },
      { out: () => undefined, err: (t) => errors.push(t) },
    );
    expect(code).toBe(1);
    expect(errors.join('')).toMatch(/could not fetch https:\/\/binaries\.prisma\.sh\/all_commits\/.*ECONNREFUSED/);
    expect(requested.length).toBe(2 * (FETCH_RETRIES + 1));
    expect(engineFiles(box.enginesDir)).toEqual([]);
  });

  it('[SEC-TC-64] (iii) --verify-only never fetches: an empty engine directory fails without a request', async () => {
    const box = sandbox();
    const { transport, requested } = origin();
    expect(
      await run(['--verify-only'], { ...box, target: TARGET, transport, env: {} }, { out: () => undefined, err: () => undefined }),
    ).toBe(1);
    expect(requested).toEqual([]);
  });

  it('[SEC-TC-64] (v) a manifest whose enginesVersion differs from the installed @prisma/engines-version exits 1 before any request', async () => {
    const box = sandbox({ enginesVersion: 'f'.repeat(40) });
    const { transport, requested } = origin();
    const errors: string[] = [];
    const code = await run([], { ...box, target: TARGET, transport, env: {} }, { out: () => undefined, err: (t) => errors.push(t) });
    expect(code).toBe(1);
    expect(errors.join('')).toContain(
      `engine manifest is stale: enginesVersion ${'f'.repeat(40)} != installed @prisma/engines-version ${VERSION}`,
    );
    expect(requested).toEqual([]);
  });

  it('[SEC-TC-64] refuses a manifest whose source differs from the fixed origin, and an unknown binary target', async () => {
    const box = sandbox({ source: 'https://engines.invalid/all_commits/' });
    await expect(ensureEngine({ ...box, target: TARGET, env: {} })).rejects.toThrow(/differs from the fixed origin/);
    const ok = sandbox();
    await expect(ensureEngine({ ...ok, target: 'darwin-arm64', env: {} })).rejects.toThrow(/darwin-arm64 is not in the engine manifest/);
  });

  it('[SEC-TC-64] follows redirects only within the origin and only over HTTPS; client errors are not retried', async () => {
    const url = engineUrl(VERSION, TARGET);
    const hop =
      (location: string): Transport =>
      async (requested) =>
        requested === url ? { status: 302, location, body: Buffer.alloc(0) } : { status: 200, body: Buffer.from('ok') };
    await expect(fetchFromOrigin(url, { transport: hop('/all_commits/elsewhere'), maxBytes: 10, sleep: noSleep })).resolves.toEqual(
      Buffer.from('ok'),
    );
    await expect(fetchFromOrigin(url, { transport: hop('https://evil.example/x'), maxBytes: 10, sleep: noSleep })).rejects.toThrow(
      /redirect outside/,
    );
    await expect(fetchFromOrigin(url, { transport: hop('http://binaries.prisma.sh/x'), maxBytes: 10, sleep: noSleep })).rejects.toThrow(
      /redirect outside/,
    );
    await expect(fetchFromOrigin('https://evil.example/x', { maxBytes: 10 })).rejects.toThrow(/outside https:\/\/binaries\.prisma\.sh/);
    let calls = 0;
    const notFound: Transport = async () => {
      calls += 1;
      return { status: 404, body: Buffer.alloc(0) };
    };
    await expect(fetchFromOrigin(url, { transport: notFound, maxBytes: 10, sleep: noSleep })).rejects.toThrow(/HTTP 404/);
    expect(calls).toBe(1);
  });

  it('[SEC-TC-64] retries with exponential backoff and jitter before succeeding', async () => {
    const delays: number[] = [];
    let calls = 0;
    const flaky: Transport = async () => {
      calls += 1;
      return calls < 3 ? { status: 503, body: Buffer.alloc(0) } : { status: 200, body: Buffer.from('ok') };
    };
    const body = await fetchFromOrigin(engineUrl(VERSION, TARGET), {
      transport: flaky,
      maxBytes: 10,
      random: () => 0.5,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    expect(body.toString()).toBe('ok');
    expect(delays).toEqual([750, 1500]);
  });

  it('[SEC-TC-64] the recording procedure reports transport and binary hashes per target and writes nothing', async () => {
    const box = sandbox();
    const { transport } = origin();
    const record = await recordHashes({ enginesVersion: VERSION, targets: [TARGET], transport });
    expect(record).toEqual({
      enginesVersion: VERSION,
      source: ENGINE_ORIGIN,
      results: [{ target: TARGET, url: engineUrl(VERSION, TARGET), gzSha256: sha256(gz), bytes: binary.length, sha256: sha256(binary) }],
    });
    expect(engineFiles(box.enginesDir)).toEqual([]);
    await expect(recordHashes({ enginesVersion: 'nope', targets: [TARGET], transport })).rejects.toThrow(EngineError);
    const out: string[] = [];
    const quiet = { out: (text: string) => out.push(text), err: () => undefined };
    expect(await run(['--record', `--targets=${TARGET}`], { manifestPath: box.manifestPath, transport }, quiet)).toBe(0);
    expect(JSON.parse(out.join('')).results[0].sha256).toBe(sha256(binary));
    expect(await run(['--record'], { manifestPath: join(work, 'absent.json'), transport }, quiet)).toBe(1);
  });

  it('[SEC-TC-64] Prisma children get the verified engine path and CHECKPOINT_DISABLE, and never an inherited redirect', () => {
    const env = prismaChildEnv(
      { PATH: '/bin', prisma_engines_mirror: 'https://engines.invalid', BINARY_DOWNLOAD_VERSION: 'x' },
      '/verified/engine',
    );
    expect(env).toEqual({ PATH: '/bin', PRISMA_SCHEMA_ENGINE_BINARY: '/verified/engine', CHECKPOINT_DISABLE: '1' });
  });

  it('[SEC-TC-64] a change of the engine while Prisma ran is detected and the file removed', () => {
    const box = sandbox();
    const path = join(box.enginesDir, engineFileName(TARGET));
    writeFileSync(path, binary);
    expect(() => reverifyEngine(path, sha256(binary))).not.toThrow();
    writeFileSync(path, 'swapped');
    expect(() => reverifyEngine(path, sha256(binary))).toThrow(/changed while Prisma ran/);
    expect(existsSync(path)).toBe(false);
  });
});

describe('poisoned per-user Prisma cache (SEC-TC-64 (iv))', () => {
  let cacheRoot: string;
  let poisonedDir: string;
  let target: string;
  const poison = Buffer.from('#!/bin/sh\necho poisoned engine\n');
  const childEnv = (): NodeJS.ProcessEnv => {
    const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: cacheRoot, XDG_CACHE_HOME: cacheRoot, LOCALAPPDATA: cacheRoot };
    delete env['CHECKPOINT_DISABLE'];
    return env;
  };

  beforeAll(() => {
    cacheRoot = mkdtempSync(join(tmpdir(), 'sec-tc-64-cache-'));
    target = process.platform === 'win32' ? 'windows' : TARGET;
    // Prisma's cache layout: <root>/{Prisma on Windows | prisma elsewhere}/master/<enginesVersion>/<target>/schema-engine
    poisonedDir = join(cacheRoot, process.platform === 'win32' ? 'Prisma' : 'prisma', 'master', VERSION, target);
    mkdirSync(poisonedDir, { recursive: true });
    writeFileSync(join(poisonedDir, 'schema-engine'), poison);
    writeFileSync(join(poisonedDir, 'schema-engine.sha256'), sha256(poison));
    writeFileSync(join(poisonedDir, 'schema-engine.gz.sha256'), sha256(gzipSync(poison)));
  });

  afterAll(() => rmSync(cacheRoot, { recursive: true, force: true }));

  it("[SEC-TC-64] (iv) control: the poisoned entry sits exactly where Prisma's downloader looks for its cache", () => {
    // The same resolution chain as the CLI: prisma -> @prisma/engines -> @prisma/fetch-engine (channel "master").
    const enginesManifest = createRequire(createRequire(join(repoRoot, 'prisma', 'package.json')).resolve('prisma/package.json')).resolve(
      '@prisma/engines/package.json',
    );
    const entry = createRequire(enginesManifest).resolve('@prisma/fetch-engine');
    const probe = runNode(
      [
        '-e',
        `require(${JSON.stringify(entry)}).getCacheDir('master', ${JSON.stringify(VERSION)}, ${JSON.stringify(target)}).then((d) => process.stdout.write(String(d)))`,
      ],
      { cwd: repoRoot, env: childEnv() },
    );
    expect(probe.status).toBe(0);
    expect(probe.stdout.toLowerCase()).toBe(poisonedDir.toLowerCase());
  });

  it('[SEC-TC-64] (iv) a poisoned per-user cache entry is ignored: after prisma generate the engine in node_modules equals the manifest', async () => {
    const manifest = readManifest(realManifestPath);
    const { enginesDir } = locateInstall(repoRoot);
    const engine = join(enginesDir, engineFileName(target));
    const result = await withFileLock(PRISMA_TREE_LOCK, () =>
      runNode([join(repoRoot, 'tools', 'deps', 'prisma-cli.mjs'), '--verify-only', 'generate'], {
        cwd: repoRoot,
        env: childEnv(),
        timeoutMs: 180_000,
      }),
    );
    expect(result.stderr).not.toContain('no verified schema engine'); // run `npm run deps:rebuild` first
    expect(result.status).toBe(0);
    expect(sha256(readFileSync(engine))).toBe(manifest.schemaEngine[target]?.sha256);
    // The cache was neither used nor written: the poisoned files are unchanged and nothing else appeared.
    expect(readFileSync(join(poisonedDir, 'schema-engine')).equals(poison)).toBe(true);
    expect(readdirSync(poisonedDir).sort()).toEqual(['schema-engine', 'schema-engine.gz.sha256', 'schema-engine.sha256']);
  }, 180_000);
});
