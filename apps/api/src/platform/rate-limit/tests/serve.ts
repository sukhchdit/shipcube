/**
 * Test helper (TASK-041): serves an Express app on an ephemeral loopback port, lazily on its first call, and talks to it
 * through the shared one-shot loopback transport of TASK-291 (`fetchOnce`: a fresh socket per request, no pooled
 * client; `closeLoopbackServer`). Never imported by production code.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';

import { closeLoopbackServer, fetchOnce } from '../../routing/tests/loopback.js';

const served = new Map<Express, { readonly base: string; readonly server: Server }>();

async function baseOf(app: Express): Promise<string> {
  const existing = served.get(app);
  if (existing !== undefined) return existing.base;
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  served.set(app, { base, server });
  return base;
}

export interface Reply {
  readonly status: number;
  /** Lower-case header names. */
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: unknown;
}

/** One request to `app`; the body is parsed JSON (or problem+json), else the text, else undefined. */
export async function call(
  app: Express,
  method: string,
  path: string,
  options: { readonly headers?: Readonly<Record<string, string>>; readonly body?: unknown } = {},
): Promise<Reply> {
  const base = await baseOf(app);
  const response = await fetchOnce(`${base}${path}`, {
    method,
    headers: { ...(options.body === undefined ? {} : { 'content-type': 'application/json' }), ...options.headers },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  let body: unknown = text === '' ? undefined : text;
  try {
    body = text === '' ? undefined : (JSON.parse(text) as unknown);
  } catch {
    // Not JSON (the docs page): the text stays.
  }
  return { status: response.status, headers, body };
}

/** A request under construction (a thenable, like Supertest's): set headers, send a body, then await. */
class Pending implements PromiseLike<Reply> {
  private readonly headers: Record<string, string> = {};
  private payload: unknown;

  constructor(
    private readonly app: Express,
    private readonly method: string,
    private readonly path: string,
  ) {}

  set(name: string | Readonly<Record<string, string>>, value?: string): this {
    if (typeof name === 'string') this.headers[name] = value ?? '';
    else Object.assign(this.headers, name);
    return this;
  }

  send(body: unknown): this {
    this.payload = body;
    return this;
  }

  then<R1 = Reply, R2 = never>(
    onfulfilled?: ((value: Reply) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return call(this.app, this.method, this.path, {
      headers: this.headers,
      ...(this.payload === undefined ? {} : { body: this.payload }),
    }).then(onfulfilled, onrejected);
  }
}

/** The part of Supertest's surface these suites use, over the one-shot loopback transport. */
export const request = (app: Express): { get(path: string): Pending; post(path: string): Pending } => ({
  get: (path) => new Pending(app, 'GET', path),
  post: (path) => new Pending(app, 'POST', path),
});

/** Closes every app served so far (afterAll). */
export async function closeServedApps(): Promise<void> {
  const servers = [...served.values()].map((entry) => entry.server);
  served.clear();
  await Promise.all(servers.map((server) => closeLoopbackServer(server)));
}
