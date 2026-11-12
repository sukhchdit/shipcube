/**
 * Graceful shutdown on SIGTERM/SIGINT (NFR-AVAIL-002, REQ-PLAT-022): readiness turns 503 at once, the listener
 * stops accepting and in-flight work drains within a bounded time, then the pool and Valkey close (each bounded),
 * and the process exits 0 on a clean drain or 1 when a bound was hit. A second signal does not restart the
 * sequence. Process-agnostic: the caller supplies the listener and the resources.
 */
import type { RuntimeLog } from './log.js';
import type { ReadinessProbe } from './readiness.js';

/** In-flight requests and jobs finish within this time (the ECS stop timeout is 30 s; US-013). */
export const DRAIN_TIMEOUT_MS = 25_000;
/** Budget to close each resource (pool, Valkey). */
export const RESOURCE_CLOSE_TIMEOUT_MS = 3_000;

export interface Closeable {
  readonly name: string;
  close(): Promise<void>;
}

export interface ShutdownOptions {
  readonly probe: Pick<ReadinessProbe, 'startDraining'>;
  /** Stops accepting and resolves once in-flight work has finished. */
  readonly drain: () => Promise<void>;
  /** Called when the drain bound is hit (for example `server.closeAllConnections()`). */
  readonly forceClose?: () => void;
  /** Closed in parallel after the drain. */
  readonly resources: readonly Closeable[];
  readonly log: RuntimeLog;
  readonly exit: (code: number) => void;
  readonly drainTimeoutMs?: number;
  readonly closeTimeoutMs?: number;
}

const TIMED_OUT = Symbol('timed-out');

async function within<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const errorClass = (error: unknown): string => (error instanceof Error ? error.name : 'non-error');

/** Returns the signal handler; the first call runs the sequence, later calls return the same promise. */
export function createShutdown(options: ShutdownOptions): (signal: string) => Promise<void> {
  let running: Promise<void> | undefined;
  const drainTimeoutMs = options.drainTimeoutMs ?? DRAIN_TIMEOUT_MS;
  const closeTimeoutMs = options.closeTimeoutMs ?? RESOURCE_CLOSE_TIMEOUT_MS;

  async function closeResource(resource: Closeable): Promise<boolean> {
    try {
      if ((await within(resource.close(), closeTimeoutMs)) !== TIMED_OUT) return true;
      options.log.warn('shutdown.close_timeout', { resource: resource.name });
    } catch (error) {
      options.log.warn('shutdown.close_failed', { resource: resource.name, error: errorClass(error) });
    }
    return false;
  }

  async function run(signal: string): Promise<void> {
    const started = performance.now();
    options.probe.startDraining();
    options.log.info('shutdown.start', { signal });
    let clean = true;
    try {
      if ((await within(options.drain(), drainTimeoutMs)) === TIMED_OUT) {
        clean = false;
        options.log.warn('shutdown.drain_timeout', { timeoutMs: drainTimeoutMs });
        options.forceClose?.();
      }
    } catch (error) {
      clean = false;
      options.log.warn('shutdown.drain_failed', { error: errorClass(error) });
    }
    const closed = await Promise.all(options.resources.map(closeResource));
    const code = clean && closed.every(Boolean) ? 0 : 1;
    options.log.info('shutdown.done', { code, durationMs: Math.round(performance.now() - started) });
    options.exit(code);
  }

  return (signal) => {
    running ??= run(signal);
    return running;
  };
}
