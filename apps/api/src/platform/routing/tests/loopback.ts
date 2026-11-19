/**
 * Test helper (TASK-020, PR #38 code review R1-n1): the per-test timeout of suites that compose createApp and make real
 * loopback requests. The 5 s Jest default timed out under parallel host load in the heavy lane (runs 20261113T2208Z
 * and 20261113T2226Z, never in isolation); one case takes about 15-100 ms alone, so 180 s is wide headroom, not a mask.
 * One constant, so a later change reaches every such file. Never imported by production code.
 */
import { request as httpRequest, type Server } from 'node:http';

export { HOST_LOAD_SLACK_MS, LOOPBACK_TEST_TIMEOUT_MS, timeOperation } from './timing.js';

/**
 * Closes a loopback test server and every socket still open on it. `server.close()` alone waits for the keep-alive
 * connection that `fetch` keeps open (a connection the server has not yet marked idle is not dropped by Node), so under
 * host load a probe could sit in `close()` until the keep-alive timeout; the response was already read in full.
 */
export function closeLoopbackServer(server: Server): Promise<void> {
  return new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

/** The per-request deadline of {@link fetchOnce}: a hang fails fast and named instead of consuming the whole test budget. */
export const FETCH_ONCE_DEADLINE_MS = 60_000;

/** Thrown (rejected) by {@link fetchOnce} when the server sent no complete response within the deadline. */
export class FetchOnceTimeoutError extends Error {
  override readonly name = 'FetchOnceTimeoutError';
}

export interface FetchOnceOptions {
  /** Test seam for {@link FetchOnceTimeoutError}; defaults to {@link FETCH_ONCE_DEADLINE_MS}. */
  readonly deadlineMs?: number;
}

/**
 * A one-shot HTTP request to a loopback test server that returns a fetch `Response`: a fresh socket (`agent: false`,
 * `Connection: close`) and no connection pool. Under host load the global fetch dispatcher left a connect that the server
 * had accepted without ever delivering its request (the pooled client for a recycled ephemeral port, or one idled out during
 * a stall); the case then waited for the whole test budget (W0-FLAKE). The response is read in full before it is returned.
 *
 * Only string and byte bodies (sent with `Content-Length`, like fetch), no redirects. An unsupported body is refused BEFORE
 * anything is sent. An already-aborted `init.signal` rejects without sending; a later abort destroys the request. No
 * complete response within the deadline rejects with {@link FetchOnceTimeoutError} naming the method and path.
 * Never imported by production code.
 */
export function fetchOnce(url: string, init: RequestInit = {}, options: FetchOnceOptions = {}): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const target = new URL(url);
    const method = init.method ?? 'GET';
    const path = `${target.pathname}${target.search}`;
    const { body, signal } = init;
    let payload: Buffer | undefined;
    if (typeof body === 'string') payload = Buffer.from(body);
    else if (body instanceof Uint8Array) payload = Buffer.from(body);
    else if (body !== undefined && body !== null) {
      reject(new TypeError('fetchOnce: only string and byte bodies are supported'));
      return;
    }
    if (signal?.aborted === true) {
      reject(signal.reason instanceof Error ? signal.reason : new Error('fetchOnce: aborted'));
      return;
    }
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, name) => {
      headers[name] = value;
    });
    headers['connection'] = 'close';
    if (payload !== undefined) headers['content-length'] = String(payload.byteLength);
    const deadlineMs = options.deadlineMs ?? FETCH_ONCE_DEADLINE_MS;
    const timer = setTimeout(() => {
      request.destroy(new FetchOnceTimeoutError(`fetchOnce: no response from ${method} ${path} within ${String(deadlineMs)} ms`));
    }, deadlineMs);
    const onAbort = (): void => {
      request.destroy(signal?.reason instanceof Error ? signal.reason : new Error('fetchOnce: aborted'));
    };
    const settle = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const request = httpRequest(
      {
        hostname: target.hostname.replace(/^\[|\]$/g, ''),
        port: target.port,
        path,
        method,
        headers,
        agent: false,
        // Node keeps only the first copy of etag, location and 14 other headers a response sends twice; join them like fetch (PR291-SEC-01).
        joinDuplicateHeaders: true,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('error', (error) => {
          settle();
          reject(error);
        });
        response.on('end', () => {
          settle();
          const answered = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (Array.isArray(value)) for (const item of value) answered.append(name, item);
            else if (value !== undefined) answered.set(name, value);
          }
          const status = response.statusCode ?? 0;
          const withoutBody = status === 101 || status === 204 || status === 205 || status === 304;
          resolve(
            new Response(withoutBody ? null : Buffer.concat(chunks), {
              status,
              statusText: response.statusMessage ?? '',
              headers: answered,
            }),
          );
        });
      },
    );
    request.on('error', (error) => {
      settle();
      reject(error);
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    if (payload !== undefined) request.write(payload);
    request.end();
  });
}
