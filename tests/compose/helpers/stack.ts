/**
 * Helpers of the Compose/image stack suite (TASK-014; `npm run test:stack`, tools/compose/run-stack-tests.mjs).
 * Docker is driven through `docker` / `docker compose` child processes without a shell. Every wait polls with a
 * deadline (no fixed sleeps). Output that could hold a value is only matched, never printed by these helpers.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { dirname, join, resolve } from 'node:path';

export interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** The workspace root (the directory whose package.json declares workspaces), searched upwards from the cwd. */
export function repoRoot(start: string = process.cwd()): string {
  let dir = resolve(start);
  for (;;) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest) && Array.isArray((JSON.parse(readFileSync(manifest, 'utf8')) as { workspaces?: unknown }).workspaces))
      return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('no workspace root above the working directory');
    dir = parent;
  }
}

export const ROOT = repoRoot();

/** `docker <args>`; never throws on a non-zero exit (the caller asserts). */
export function docker(args: readonly string[], options: { timeoutMs?: number; input?: string; env?: NodeJS.ProcessEnv } = {}): Run {
  const result = spawnSync('docker', [...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 600_000,
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
    env: options.env ?? process.env,
    ...(options.input === undefined ? {} : { input: options.input }),
  });
  if (result.error !== undefined) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** A unique Compose project per run, so a developer's own `shipcube` stack is never touched. */
export const uniqueProject = (): string => `t014-${randomBytes(4).toString('hex')}`;

/**
 * The suite's Compose environment: the data services' host ports move off the developer defaults (5432, 6379, 1025,
 * 8025), which a host PostgreSQL or another stack may hold; the suite reaches those services through `docker compose
 * exec`, never through the host port. Edge ports stay, because the origins and STORAGE_PUBLIC_ENDPOINT name them.
 */
export const STACK_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  POSTGRES_HOST_PORT: process.env.POSTGRES_HOST_PORT ?? '25432',
  REDIS_HOST_PORT: process.env.REDIS_HOST_PORT ?? '26379',
  MAILPIT_SMTP_HOST_PORT: process.env.MAILPIT_SMTP_HOST_PORT ?? '21025',
  MAILPIT_UI_HOST_PORT: process.env.MAILPIT_UI_HOST_PORT ?? '28025',
};

export class ComposeStack {
  constructor(
    readonly project: string,
    readonly files: readonly string[] = ['compose.yaml'],
    readonly env: NodeJS.ProcessEnv = STACK_ENV,
  ) {}

  run(args: readonly string[], timeoutMs = 600_000): Run {
    const fileArgs = this.files.flatMap((file) => ['-f', file]);
    return docker(['compose', '-p', this.project, ...fileArgs, ...args], { timeoutMs, env: this.env });
  }

  /** Always succeeds or reports; removes containers, networks and every named volume of the project. */
  down(): Run {
    return this.run(['down', '-v', '--remove-orphans', '--timeout', '10'], 180_000);
  }

  /** `docker compose ps -a --format json`, one object per container. */
  ps(): ContainerState[] {
    const result = this.run(['ps', '-a', '--format', 'json'], 60_000);
    return result.stdout
      .split(/\r?\n/)
      .filter((line) => line.trim().startsWith('{'))
      .map((line) => JSON.parse(line) as ContainerState);
  }

  /** psql as the cluster superuser over the container's local socket; returns unaligned, tuples-only output. */
  psql(sql: string): string {
    const result = this.run(
      ['exec', '-T', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'platform', '-At', '-c', sql],
      60_000,
    );
    if (result.status !== 0) throw new Error(`psql failed (exit ${String(result.status)})`);
    return result.stdout.trim();
  }

  logs(service: string): string {
    return this.run(['logs', '--no-color', service], 60_000).stdout;
  }
}

export interface ContainerState {
  readonly Service: string;
  readonly State: string;
  readonly Health?: string;
  readonly ExitCode?: number;
  readonly Publishers?: readonly { URL: string; TargetPort: number; PublishedPort: number }[];
}

/** Polls `probe` until it returns a value other than undefined, or throws after `timeoutMs`. */
export async function waitFor<T>(
  what: string,
  probe: () => T | undefined | Promise<T | undefined>,
  timeoutMs: number,
  intervalMs = 1_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() >= deadline) throw new Error(`timed out after ${String(timeoutMs)} ms waiting for ${what}`);
    await new Promise((done) => setTimeout(done, intervalMs));
  }
}

export interface HttpResult {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: Buffer;
}

export interface HttpOptions {
  readonly port: number;
  readonly path: string;
  readonly method?: string;
  /** Sent verbatim (Host included: node:http lets the caller set it, unlike fetch). */
  readonly headers?: Readonly<Record<string, string>>;
  /** HTTPS with this PEM as the only trust anchor (the edge's self-signed local certificate). */
  readonly ca?: string;
  readonly timeoutMs?: number;
}

/** One HTTP(S) request to 127.0.0.1; resolves with status, headers and the body; rejects on transport errors. */
export function http(options: HttpOptions): Promise<HttpResult> {
  return new Promise((resolvePromise, reject) => {
    const common = {
      host: '127.0.0.1',
      port: options.port,
      path: options.path,
      method: options.method ?? 'GET',
      headers: { ...options.headers },
      timeout: options.timeoutMs ?? 10_000,
    };
    const callback = (response: IncomingMessage): void => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () =>
        resolvePromise({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) }),
      );
      response.on('error', reject);
    };
    const req =
      options.ca === undefined
        ? httpRequest(common, callback)
        : httpsRequest({ ...common, ca: options.ca, servername: 'localhost' }, callback);
    req.on('timeout', () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
    req.end();
  });
}

/** Resolves undefined instead of rejecting (for polling). */
export async function tryHttp(options: HttpOptions): Promise<HttpResult | undefined> {
  try {
    return await http(options);
  } catch {
    return undefined;
  }
}

/**
 * Names of the reference datasets registered in the seed framework now (prisma/seed/reference/index.ts), read in a
 * child process through tsx and the @platform/source condition, as the seed one-shot runs it (AT-US-049-02).
 */
export function referenceDatasetNames(): string[] {
  const script =
    "const m = await import('./prisma/seed/reference/index.ts'); process.stdout.write(JSON.stringify(m.REFERENCE_DATASETS.map((d) => d.name)));";
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--conditions=@platform/source', '--input-type=module', '-e', script], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120_000,
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`reading the reference seed registry failed (exit ${String(result.status)})`);
  return JSON.parse(result.stdout) as string[];
}

/** `true` when the Docker engine answers within the timeout (the stack suite needs a working engine). */
export function dockerAvailable(): boolean {
  try {
    return docker(['version', '--format', '{{.Server.Version}}'], { timeoutMs: 30_000 }).status === 0;
  } catch {
    return false;
  }
}
