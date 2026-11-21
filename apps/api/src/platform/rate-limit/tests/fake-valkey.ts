/**
 * Test double of the part of the ioredis client the rate limiter uses (`eval`), interpreting the four Lua scripts of
 * store.ts and denial-budget.ts in JavaScript with a controllable clock. Several apps share one instance to model
 * several API replicas on one Valkey. It proves the TypeScript side (arguments, reply parsing, fallbacks); the real
 * Lua semantics (atomicity, PTTL) are proved against a real Valkey in rate-limit.int.test.ts. Never imported by
 * production code.
 */
import { RESTORE_SCRIPT, TAKE_SCRIPT } from '../denial-budget.js';
import { ACQUIRE_SCRIPT, HIT_SCRIPT, RELEASE_SCRIPT, type ScriptClient } from '../store.js';

interface Entry {
  value: number;
  expiresAt: number | undefined;
}

export class FakeValkey implements ScriptClient {
  /** The clock in milliseconds; tests advance it. */
  time = 1_800_000_000_000;
  /** When set, every call rejects with it (an outage). */
  failure: Error | undefined;
  /** Number of `eval` calls. */
  calls = 0;
  private readonly entries = new Map<string, Entry>();
  private readonly sets = new Map<string, Map<string, number>>();

  private live(key: string): Entry | undefined {
    const entry = this.entries.get(key);
    if (entry?.expiresAt !== undefined && entry.expiresAt <= this.time) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  private incr(key: string, by = 1): number {
    const entry = this.live(key) ?? { value: 0, expiresAt: undefined };
    entry.value += by;
    this.entries.set(key, entry);
    return entry.value;
  }

  /** Remaining time to live in ms: -2 missing, -1 no expiry (the real PTTL). */
  pttl(key: string): number {
    const entry = this.live(key);
    if (entry === undefined) return -2;
    return entry.expiresAt === undefined ? -1 : entry.expiresAt - this.time;
  }

  /** Every live key (the grammar test reads them). */
  keys(): string[] {
    return [...this.entries.keys(), ...this.sets.keys()].filter((key) => this.live(key) !== undefined || this.sets.has(key));
  }

  value(key: string): number | undefined {
    return this.live(key)?.value;
  }

  private expire(key: string, ms: number): void {
    const entry = this.entries.get(key);
    if (entry !== undefined) entry.expiresAt = this.time + ms;
  }

  eval(script: string, numberOfKeys: number, ...args: string[]): Promise<unknown> {
    this.calls += 1;
    if (this.failure !== undefined) return Promise.reject(this.failure);
    const keys = args.slice(0, numberOfKeys);
    const argv = args.slice(numberOfKeys);
    const key = keys[0] as string;
    switch (script) {
      case HIT_SCRIPT: {
        const count = this.incr(key);
        if (count === 1) this.expire(key, Number(argv[0]));
        return Promise.resolve([count, this.pttl(key)]);
      }
      case TAKE_SCRIPT: {
        const carryKey = keys[1] as string;
        const count = this.incr(key);
        let claimed = 0;
        if (count === 1) {
          this.expire(key, Number(argv[0]));
          const carry = this.live(carryKey);
          this.entries.delete(carryKey);
          if (carry !== undefined) claimed = carry.value;
        } else if (count > Number(argv[1]) + 1) {
          this.incr(carryKey);
          this.expire(carryKey, Number(argv[2]) * 1000);
        }
        return Promise.resolve([count, this.pttl(key), claimed]);
      }
      case RESTORE_SCRIPT:
        this.incr(key, Number(argv[0]));
        this.expire(key, Number(argv[1]) * 1000);
        return Promise.resolve(1);
      case ACQUIRE_SCRIPT: {
        const held = this.sets.get(key) ?? new Map<string, number>();
        for (const [holder, expiresAt] of held) if (expiresAt <= this.time) held.delete(holder);
        this.sets.set(key, held);
        if (held.size >= Number(argv[1])) return Promise.resolve(0);
        held.set(argv[0] as string, this.time + Number(argv[2]));
        return Promise.resolve(1);
      }
      case RELEASE_SCRIPT:
        return Promise.resolve(this.sets.get(key)?.delete(argv[0] as string) === true ? 1 : 0);
      default:
        return Promise.reject(new Error('unknown script'));
    }
  }
}
