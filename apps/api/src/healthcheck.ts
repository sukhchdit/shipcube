// Container HEALTHCHECK probe of the api image (TASK-014, US-004 scenario 4; platform.md §2.2 and §3.2): GET
// http://127.0.0.1:${APP_PORT||3000}/health/ready within 2 s, exit 0 on 200 and 1 otherwise. Node builtins only: it
// loads no configuration (a rejected configuration must not turn the probe into a crash loop) and never prints a
// response body. The Dockerfile runs it as `env -u NODE_OPTIONS node dist/healthcheck.js`.
import { request } from 'node:http';
import process from 'node:process';

/** Readiness path of the api (apps/api/src/platform/health/router.ts HEALTH_READY_PATH). */
export const READY_PATH = '/health/ready';
export const DEFAULT_PORT = 3000;
export const BUDGET_MS = 2000;

/** Port from APP_PORT when it is a valid TCP port, else the default (the probe never fails on a bad variable). */
export function probePort(value: string | undefined, fallback: number = DEFAULT_PORT): number {
  const port = Number(value);
  return /^\d+$/.test(value ?? '') && port > 0 && port < 65536 ? port : fallback;
}

/** Resolves true only for a 200 answer within `budgetMs`; every error, timeout or other status resolves false. */
export function probeReady(port: number, options: { host?: string; path?: string; budgetMs?: number } = {}): Promise<boolean> {
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

if (import.meta.main === true) {
  void probeReady(probePort(process.env['APP_PORT'])).then((ready) => {
    process.exitCode = ready ? 0 : 1;
  });
}
