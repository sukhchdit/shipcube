/**
 * Valkey client factory and readiness check (ADR-0013; US-012). The client is built from explicit options only
 * (`buildValkeyOptions`), never from the URL string. Connection errors are reported through `onError` as a
 * value-free class name: ioredis messages can contain the host and port (AT-US-012-05, CLAUDE.md §9).
 */
import { Redis } from 'ioredis';

import type { ReadinessCheck } from '../runtime/readiness.js';
import { buildValkeyOptions, type ValkeyOptionsInput } from './options.js';

export interface ValkeyClientOptions extends ValkeyOptionsInput {
  /** Receives the error class name of connection-level errors (ioredis emits them while it reconnects). */
  readonly onError?: (errorClass: string) => void;
}

export function createValkeyClient(options: ValkeyClientOptions): Redis {
  const client = new Redis(buildValkeyOptions(options));
  client.on('error', (error: unknown) => {
    options.onError?.(error instanceof Error ? error.name : 'non-error');
  });
  return client;
}

/** The part of the ioredis client the check uses. */
export interface PingableClient {
  ping(): Promise<string>;
}

/** `PING` must answer `PONG`; ioredis' `commandTimeout` and the readiness runner bound it. */
export function createValkeyCheck(client: PingableClient): ReadinessCheck {
  return Object.freeze({
    name: 'redis' as const,
    critical: true,
    async check(signal: AbortSignal): Promise<void> {
      signal.throwIfAborted();
      const reply = await client.ping();
      if (reply !== 'PONG') throw new Error('unexpected PING reply');
    },
  });
}
