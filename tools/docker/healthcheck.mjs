// @ts-check
/**
 * Container HEALTHCHECK probe of the api and worker images (TASK-014, US-004 scenario 4; platform.md §2.2 and §3.2).
 * The runtime stage copies it to /app/healthcheck.mjs and runs
 *
 *   /usr/bin/env -u NODE_OPTIONS node /app/healthcheck.mjs api|worker
 *
 *   api      GET http://127.0.0.1:${APP_PORT||3000}/health/ready         (apps/api/src/platform/health/router.ts)
 *   worker   GET http://127.0.0.1:${APP_HEALTH_PORT||9464}/health/ready  (apps/worker/src/platform/health/server.ts)
 *
 * within a 2 s budget: exit 0 on 200 and 1 otherwise; a missing or unknown service argument exits 1 (never healthy).
 * Node builtins only: it loads no configuration (a rejected configuration must not turn the probe into a crash loop)
 * and never prints a response body. It lives in tools/docker, not apps/<app>/src: it is an image tool, never part of
 * the served process, so the application outbound-HTTP rules do not apply to its loopback probe.
 */
import { request } from 'node:http';
import process from 'node:process';

/** Readiness path of both services (api HEALTH_READY_PATH, worker HEALTH_PATHS.ready). */
export const READY_PATH = '/health/ready';
export const BUDGET_MS = 2000;

/**
 * The probed services: the environment variable naming the listening port and its default.
 * @type {Readonly<Record<'api' | 'worker', Readonly<{ portVariable: string; defaultPort: number }>>>}
 */
export const SERVICES = Object.freeze({
  api: Object.freeze({ portVariable: 'APP_PORT', defaultPort: 3000 }),
  worker: Object.freeze({ portVariable: 'APP_HEALTH_PORT', defaultPort: 9464 }),
});

/**
 * Port from the variable when it is a valid TCP port, else the fallback (the probe never fails on a bad variable).
 * @param {string | undefined} value
 * @param {number} fallback
 * @returns {number}
 */
export function probePort(value, fallback) {
  const port = Number(value);
  return /^\d+$/.test(value ?? '') && port > 0 && port < 65536 ? port : fallback;
}

/**
 * Resolves true only for a 200 answer within `budgetMs`; every error, timeout or other status resolves false.
 * @param {number} port
 * @param {{ host?: string; path?: string; budgetMs?: number }} [options]
 * @returns {Promise<boolean>}
 */
export function probeReady(port, options = {}) {
  const { host = '127.0.0.1', path = READY_PATH, budgetMs = BUDGET_MS } = options;
  return new Promise((resolve) => {
    // agent: false + Connection: close, so no pooled keep-alive socket outlives the probe.
    const headers = { accept: 'application/json', connection: 'close' };
    const req = request({ host, port, path, method: 'GET', timeout: budgetMs, agent: false, headers }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    const deadline = setTimeout(() => req.destroy(), budgetMs);
    req.on('close', () => clearTimeout(deadline));
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
    req.end();
  });
}

/**
 * @param {string} name
 * @returns {name is keyof typeof SERVICES}
 */
function isService(name) {
  return Object.hasOwn(SERVICES, name);
}

/**
 * Probes the named service; exit code 0 = healthy, 1 = unhealthy or unusable arguments (Docker reserves exit 2).
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} [env]
 * @returns {Promise<number>}
 */
export async function main(argv, env = process.env) {
  const [name = '', ...rest] = argv;
  if (!isService(name) || rest.length > 0) {
    process.stderr.write(`usage: healthcheck.mjs ${Object.keys(SERVICES).join('|')}\n`);
    return 1;
  }
  const { portVariable, defaultPort } = SERVICES[name];
  return (await probeReady(probePort(env[portVariable], defaultPort))) ? 0 : 1;
}

if (import.meta.main === true) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
