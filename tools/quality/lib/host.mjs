// @ts-check
/**
 * Git, host and environment helpers for the lane B heavy run (TASK-011; ADR-0023 am. G item 3, I item 4; R-ARCH-16,
 * R-ARCH-21; D-ARCH-021). Every child process has a timeout; environment variables are reported by NAME only.
 * Pure helpers (`parsePorcelainZ`, `envOverrides`, `utcStamp`, `digestFromRef`, `parseNpmVersion`) are separated from
 * the thin process edges so they can be unit-tested without git or Docker.
 */
import { spawn, spawnSync } from 'node:child_process';
import { cpus, platform, release, totalmem, type } from 'node:os';

import { npmCli } from '../../deps/npm-cli.mjs';

/** Default timeout of short git/docker probes. */
export const PROBE_TIMEOUT_MS = 60_000;
/** `docker version` hangs when Docker Desktop is starting; the probe gives up quickly and records null. */
export const DOCKER_PROBE_TIMEOUT_MS = 15_000;

/**
 * @typedef {object} RunResult
 * @property {number | null} status exit code (null when killed)
 * @property {string | null} signal
 * @property {boolean} timedOut
 * @property {string} stdout
 * @property {string} stderr
 * @property {number} durationMs
 */

/**
 * Synchronous probe with a timeout and captured output (short commands only: git, docker inspect).
 * @param {string} command
 * @param {readonly string[]} args
 * @param {{ cwd: string, timeoutMs?: number }} options
 * @returns {RunResult}
 */
export function probe(command, args, { cwd, timeoutMs = PROBE_TIMEOUT_MS }) {
  const started = Date.now();
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  const timedOut = result.error !== undefined && /ETIMEDOUT/.test(String(result.error.message));
  return {
    status: result.status,
    signal: result.signal,
    timedOut,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : result.error ? String(result.error.message) : '',
    durationMs: Date.now() - started,
  };
}

/**
 * Kills a process and its children (Jest workers, Testcontainers helpers). Windows has no process groups: taskkill /T.
 * @param {number} pid
 */
function killTree(pid) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, timeout: 30_000 });
  else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      process.kill(pid, 'SIGKILL');
    }
  }
}

/**
 * Long-running child (build, one suite) with a hard timeout that kills the whole process tree. Output is streamed
 * to this process's stderr (progress for the operator) and not captured: suite results come from report files.
 * @param {string} command
 * @param {readonly string[]} args
 * @param {{ cwd: string, timeoutMs: number, env?: NodeJS.ProcessEnv }} options
 * @returns {Promise<RunResult>}
 */
export function runStreaming(command, args, { cwd, timeoutMs, env }) {
  const started = Date.now();
  return new Promise((resolvePromise) => {
    const child = spawn(command, [...args], {
      cwd,
      env: env ?? process.env,
      stdio: ['ignore', 'inherit', 'inherit'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid !== undefined) killTree(child.pid);
    }, timeoutMs);
    /** @param {number | null} status @param {string | null} signal @param {string} stderr */
    const finish = (status, signal, stderr) => {
      clearTimeout(timer);
      resolvePromise({ status, signal, timedOut, stdout: '', stderr, durationMs: Date.now() - started });
    };
    child.once('error', (error) => finish(null, null, error.message));
    child.once('exit', (code, signal) => finish(code, signal, ''));
  });
}

/** `node <npm-cli.js>` without a shell (tools/deps/npm-cli.mjs). @returns {[string, string]} */
export function npmCommand() {
  return [process.execPath, npmCli()];
}

// --- git ----------------------------------------------------------------------------------------------------------

/**
 * @param {RunResult} result
 * @param {string} what
 */
function expectOk(result, what) {
  if (result.timedOut) throw new Error(`${what} timed out`);
  if (result.status !== 0) throw new Error(`${what} failed (exit ${String(result.status)}): ${result.stderr.trim().slice(0, 300)}`);
  return result.stdout;
}

/** @param {string} cwd @returns {string} absolute repository root */
export function gitRoot(cwd) {
  return expectOk(probe('git', ['rev-parse', '--show-toplevel'], { cwd }), 'git rev-parse --show-toplevel').trim();
}

/** @param {string} root @returns {string} 40-hex HEAD sha */
export function headSha(root) {
  const sha = expectOk(probe('git', ['rev-parse', 'HEAD'], { cwd: root }), 'git rev-parse HEAD').trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`HEAD is not a 40-hex sha: ${sha.slice(0, 50)}`);
  return sha;
}

/**
 * `git status --porcelain=v1 -z` output -> entries. Renames/copies carry the source path as the following NUL field;
 * both paths are returned so a rename out of a clean-tree path is seen.
 * @param {string} output
 * @returns {Array<{ status: string, path: string }>}
 */
export function parsePorcelainZ(output) {
  const fields = output.split('\0');
  /** @type {Array<{ status: string, path: string }>} */
  const entries = [];
  for (let i = 0; i < fields.length; i += 1) {
    const field = /** @type {string} */ (fields[i]);
    if (field.length < 4) continue;
    const status = field.slice(0, 2);
    entries.push({ status, path: field.slice(3) });
    if (status.includes('R') || status.includes('C')) {
      const source = fields[i + 1];
      if (source !== undefined && source !== '') entries.push({ status, path: source });
      i += 1;
    }
  }
  return entries;
}

/** @param {string} root */
export function porcelain(root) {
  return parsePorcelainZ(
    expectOk(probe('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: root }), 'git status --porcelain'),
  );
}

/**
 * Paths changed between the merge base of `base` and HEAD (`git diff --name-only <base>...HEAD`).
 * @param {string} root
 * @param {string} base
 * @returns {string[]}
 */
export function changedPaths(root, base) {
  if (!/^[A-Za-z0-9._/@^~-]+$/.test(base) || base.startsWith('-')) throw new Error(`--base ${JSON.stringify(base)} is not a plain git ref`);
  const out = expectOk(probe('git', ['diff', '--name-only', '-z', `${base}...HEAD`], { cwd: root }), `git diff ${base}...HEAD`);
  return out.split('\0').filter((path) => path !== '');
}

// --- environment ----------------------------------------------------------------------------------------------

/**
 * Names (never values) of the variables with a recorded prefix, and the subset with an invalidating prefix.
 * @param {Readonly<Record<string, string | undefined>>} env
 * @param {readonly string[]} recordedPrefixes e.g. SKIP_, TEST_
 * @param {readonly string[]} invalidPrefixes e.g. SKIP_
 * @returns {{ names: string[], invalid: string[] }}
 */
export function envOverrides(env, recordedPrefixes, invalidPrefixes) {
  // Windows environment names are case-insensitive: compare and record upper-cased (summary.schema.json requires
  // `^[A-Z][A-Z0-9_]*$`; any other character is recorded as `_`).
  const names = [
    ...new Set(
      Object.keys(env)
        .filter((name) => env[name] !== undefined)
        .map((name) => name.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))
        .filter((name) => recordedPrefixes.some((prefix) => name.startsWith(prefix))),
    ),
  ].sort();
  const invalidOutsideRecorded = Object.keys(env)
    .filter((name) => env[name] !== undefined)
    .map((name) => name.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))
    .filter((name) => invalidPrefixes.some((prefix) => name.startsWith(prefix)));
  const invalid = [...new Set(invalidOutsideRecorded)].sort();
  return { names: [...new Set([...names, ...invalid])].sort(), invalid };
}

// --- host spec ------------------------------------------------------------------------------------------------

/**
 * @param {Date} date
 * @returns {string} UTC `YYYYMMDDTHHMMZ`
 */
export function utcStamp(date) {
  return date.toISOString().replace(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}).*$/, '$1$2$3T$4$5Z');
}

/**
 * npm version from `npm_config_user_agent` ("npm/11.19.1 node/v24.22.3 win32 x64 ...") when run through npm.
 * @param {string | undefined} agent
 * @returns {string | null}
 */
export function parseNpmVersion(agent) {
  const match = /(?:^|\s)npm\/(\d+\.\d+\.\d+)(?:\s|$)/.exec(agent ?? '');
  return match ? /** @type {string} */ (match[1]) : null;
}

/** @param {string} cwd */
function npmVersion(cwd) {
  const fromAgent = parseNpmVersion(process.env['npm_config_user_agent']);
  if (fromAgent !== null) return fromAgent;
  const [node, cli] = npmCommand();
  const out = probe(node, [cli, '--version'], { cwd, timeoutMs: PROBE_TIMEOUT_MS }).stdout.trim();
  return /^\d+\.\d+\.\d+$/.test(out) ? out : '0.0.0';
}

/** @param {string} cwd @returns {string | null} */
export function dockerVersion(cwd) {
  const result = probe('docker', ['version', '--format', '{{.Server.Version}}'], { cwd, timeoutMs: DOCKER_PROBE_TIMEOUT_MS });
  const version = result.stdout.trim();
  return result.status === 0 && /^[0-9A-Za-z.+-]{1,60}$/.test(version) ? version : null;
}

/**
 * @param {string} cwd
 * @returns {{ os: string, cpu_model: string, cores: number, ram_gb: number, docker_version: string | null, node_version: string, npm_version: string }}
 */
export function hostSpec(cwd) {
  const cpuList = cpus();
  return {
    os: `${type()} ${release()} (${platform()})`.slice(0, 120),
    cpu_model: (cpuList[0]?.model ?? 'unknown').trim().slice(0, 120),
    cores: Math.max(1, cpuList.length),
    ram_gb: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
    docker_version: dockerVersion(cwd),
    node_version: process.version,
    npm_version: npmVersion(cwd),
  };
}

// --- Testcontainers images ------------------------------------------------------------------------------------

/**
 * The digest pinned in an image reference (`name:tag@sha256:<64 hex>`), else null.
 * @param {string} ref
 * @returns {string | null}
 */
export function digestFromRef(ref) {
  const match = /@(sha256:[0-9a-f]{64})$/.exec(ref);
  return match ? /** @type {string} */ (match[1]) : null;
}

/**
 * `{ image, digest }` for every configured image: the pinned digest when the reference carries one, else the first
 * RepoDigest of the local image (`docker image inspect`, with a timeout), else null.
 * @param {readonly string[]} images
 * @param {string} cwd
 * @returns {Array<{ image: string, digest: string | null }>}
 */
export function imageDigests(images, cwd) {
  return images.map((image) => {
    const pinned = digestFromRef(image);
    if (pinned !== null) return { image, digest: pinned };
    const result = probe('docker', ['image', 'inspect', '--format', '{{json .RepoDigests}}', image], {
      cwd,
      timeoutMs: DOCKER_PROBE_TIMEOUT_MS,
    });
    /** @type {unknown} */
    let digests;
    try {
      digests = result.status === 0 ? JSON.parse(result.stdout) : [];
    } catch {
      // Unparseable inspect output means "digest unknown": recorded as null below, never guessed.
      digests = [];
    }
    const first = Array.isArray(digests) && typeof digests[0] === 'string' ? digests[0] : '';
    return { image, digest: digestFromRef(first) };
  });
}
