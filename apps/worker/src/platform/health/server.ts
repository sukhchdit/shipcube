/**
 * Worker health server (US-012; ADR-0003: the worker exposes no HTTP except /health/* and /metrics). Plain
 * node:http, because the worker has no Express. Same bodies and statuses as the API router: liveness without
 * dependency I/O, readiness from the shared probe, `Cache-Control: no-store`. Anything else is a minimal RFC 9457
 * problem (404, or 405 with `Allow` on a health path); bodies never carry internals (AT-US-012-05). With a metrics
 * source (TASK-035), `GET /metrics` answers the queue gauges in the Prometheus text format (ADR-0013 §8, AT-US-009-05).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { LIVENESS_BODY, type ReadinessProbe } from '@platform/api/runtime';

export const HEALTH_PATHS = Object.freeze({ live: '/health/live', ready: '/health/ready' });
export const METRICS_PATH = '/metrics';
const METRICS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

/** The Prometheus text of the worker's gauges (`WorkerQueues.metrics`). */
export type MetricsSource = () => Promise<string>;
const ALLOWED_METHODS = 'GET, HEAD';

function send(req: IncomingMessage, res: ServerResponse, status: number, body: object, type = 'application/json'): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': `${type}; charset=utf-8`,
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(req.method === 'HEAD' ? undefined : payload);
}

const problem = (status: 404 | 405, title: string): object => ({ type: 'about:blank', title, status });

/** The request handler, exported for tests; `createWorkerHealthServer` wraps it in an http.Server. */
export function createHealthHandler(
  probe: ReadinessProbe,
  metrics?: MetricsSource,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const path = (req.url ?? '/').split('?', 1)[0];
    if (metrics !== undefined && path === METRICS_PATH) {
      await sendMetrics(req, res, metrics);
      return;
    }
    if (path !== HEALTH_PATHS.live && path !== HEALTH_PATHS.ready) {
      send(req, res, 404, problem(404, 'Not Found'), 'application/problem+json');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', ALLOWED_METHODS);
      send(req, res, 405, problem(405, 'Method Not Allowed'), 'application/problem+json');
      return;
    }
    if (path === HEALTH_PATHS.live) {
      send(req, res, 200, LIVENESS_BODY);
      return;
    }
    const { httpStatus, body } = await probe.readiness();
    send(req, res, httpStatus, body);
  };
}

async function sendMetrics(req: IncomingMessage, res: ServerResponse, metrics: MetricsSource): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', ALLOWED_METHODS);
    send(req, res, 405, problem(405, 'Method Not Allowed'), 'application/problem+json');
    return;
  }
  const text = await metrics();
  res.writeHead(200, {
    'Content-Type': METRICS_CONTENT_TYPE,
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(req.method === 'HEAD' ? undefined : text);
}

export function createWorkerHealthServer(probe: ReadinessProbe, metrics?: MetricsSource): Server {
  const handle = createHealthHandler(probe, metrics);
  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) send(req, res, 503, { status: 'unavailable' });
      else res.destroy();
    });
  });
  // Probes are short: bound header and request time so a slow client cannot hold sockets (CLAUDE.md §9).
  server.headersTimeout = 5_000;
  server.requestTimeout = 5_000;
  server.keepAliveTimeout = 5_000;
  return server;
}
