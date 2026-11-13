// PR20-SEC-06: uncaught exceptions and unhandled rejections are written once, through the redacting logger, and the
// process exits with 1; nothing reaches Node's default stderr printer (it only runs when no listener exists).
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';

import { describe, expect, it } from '@jest/globals';

import { createRuntimeLog } from './log.js';
import { installProcessErrorHandlers } from './process-errors.js';

const sentinel = (): string => `sentinel-${randomBytes(8).toString('hex')}`;

/** A Prisma P2039-shaped error whose message, meta and driver detail carry `value`. */
function prismaShaped(value: string): Error {
  return Object.assign(new Error(`Invalid invocation: permission denied (${value})`), {
    name: 'PrismaClientKnownRequestError',
    code: 'P2039',
    clientVersion: '7.10.0',
    meta: { driverAdapterError: { cause: { originalCode: '42501', originalMessage: value, kind: 'postgres', detail: value } } },
  });
}

function setup(): { readonly source: EventEmitter; readonly raw: string[]; readonly exits: number[] } {
  const raw: string[] = [];
  const exits: number[] = [];
  const source = new EventEmitter();
  const log = createRuntimeLog('api', { write: (line: string) => raw.push(line) });
  installProcessErrorHandlers({ log, exit: (code) => exits.push(code), source });
  return { source, raw, exits };
}

describe('installProcessErrorHandlers', () => {
  it('[PR20-SEC-06] an unhandled rejection of a database error is one fatal line with the identifier-only shape, exit 1', () => {
    const value = sentinel();
    const { source, raw, exits } = setup();
    source.emit('unhandledRejection', prismaShaped(value));
    expect(raw.join('')).not.toContain(value);
    const lines = raw.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 'fatal', event: 'process.unhandled_rejection' });
    expect(lines[0]?.['err']).toMatchObject({ name: 'PrismaClientKnownRequestError', code: 'P2039' });
    expect(lines[0]?.['err']).not.toHaveProperty('message');
    expect(exits).toEqual([1]);
  });

  it('[PR20-SEC-06] an uncaught exception is written redacted with its origin, and the process exits once', () => {
    const value = sentinel();
    const { source, raw, exits } = setup();
    source.emit('uncaughtException', new Error(`boom password=${value}`), 'uncaughtException');
    source.emit('uncaughtException', new Error('second'), 'not-an-origin');
    expect(raw.join('')).not.toContain(value);
    const lines = raw.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.map((line) => [line['event'], line['origin']])).toEqual([
      ['process.uncaught_exception', 'uncaughtException'],
      ['process.uncaught_exception', undefined],
    ]);
    expect(exits).toEqual([1]);
  });

  it('exits even when the logger throws', () => {
    const exits: number[] = [];
    const source = new EventEmitter();
    installProcessErrorHandlers({
      log: {
        fatal: () => {
          throw new Error('destination failed');
        },
      },
      exit: (code) => exits.push(code),
      source,
    });
    expect(() => source.emit('unhandledRejection', new Error('x'))).toThrow('destination failed');
    expect(exits).toEqual([1]);
  });
});
