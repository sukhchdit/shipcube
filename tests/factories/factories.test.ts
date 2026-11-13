import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import { createFactories, createRng, runIdentity } from './index.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Everything one factory set produces for a fixed call sequence. */
function sample(seed: string, workerId: string) {
  const f = createFactories({ seed, workerId });
  return [f.user(), f.user(), f.organisation(), f.membership(), f.quote(), f.shipment(), f.order(), f.payment(), f.document()];
}

describe('[NFR-QUAL-006] seeded RNG', () => {
  it('the same seed yields the same sequence; a different seed yields a different one', () => {
    const a = createRng('seed-a');
    const b = createRng('seed-a');
    const c = createRng('seed-b');
    const first = Array.from({ length: 8 }, () => a.next());
    expect(Array.from({ length: 8 }, () => b.next())).toEqual(first);
    expect(Array.from({ length: 8 }, () => c.next())).not.toEqual(first);
    for (const value of first) expect(value).toBeGreaterThanOrEqual(0);
    for (const value of first) expect(value).toBeLessThan(1);
  });

  it('int is inclusive on both ends and rejects bad ranges; pick rejects an empty list', () => {
    const rng = createRng(1);
    const seen = new Set(Array.from({ length: 200 }, () => rng.int(3, 5)));
    expect([...seen].sort()).toEqual([3, 4, 5]);
    expect(() => rng.int(5, 3)).toThrow(RangeError);
    expect(() => rng.int(1.5, 3)).toThrow(RangeError);
    expect(() => rng.pick([])).toThrow(RangeError);
  });

  it('uuid() has the version-7 and variant bits; fork() is independent of the parent stream', () => {
    const rng = createRng('u');
    for (let i = 0; i < 50; i += 1) expect(rng.uuid()).toMatch(UUID_V7);
    const parent = createRng('p');
    const untouched = createRng('p');
    parent.fork('child').next();
    expect(parent.next()).toBe(untouched.next());
    expect(createRng('p').fork('x').next()).toBe(createRng('p').fork('x').next());
    expect(createRng('p').fork('x').next()).not.toBe(createRng('p').fork('y').next());
  });
});

describe('[NFR-QUAL-006] factories are deterministic per seed', () => {
  it('two factory sets with the same seed and worker produce identical records', () => {
    expect(sample('s1', '1')).toEqual(sample('s1', '1'));
  });

  it('property: determinism holds for any seed; records differ across seeds', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 24 }), fc.string({ minLength: 1, maxLength: 24 }), (a, b) => {
        expect(sample(a, '1')).toEqual(sample(a, '1'));
        if (a !== b) expect(sample(a, '1')[0]).not.toEqual(sample(b, '1')[0]);
      }),
      { numRuns: 40, seed: 20261113 },
    );
  });

  it('adding a call to one factory does not shift another factory (independent streams)', () => {
    const plain = createFactories({ seed: 'iso', workerId: '1' });
    const noisy = createFactories({ seed: 'iso', workerId: '1' });
    noisy.organisation();
    noisy.quote();
    expect(noisy.user()).toEqual(plain.user());
  });

  it('records use a fixed clock unless one is injected, and never the wall clock', () => {
    const fixed = createFactories({ seed: 'c', workerId: '1' }).user();
    expect(fixed.createdAt.toISOString()).toBe('2026-01-15T12:00:00.000Z');
    const at = new Date('2030-02-03T04:05:06.000Z');
    const injected = createFactories({ seed: 'c', workerId: '1', now: () => at }).quote();
    expect(injected.createdAt).toEqual(at);
    expect(injected.expiresAt.getTime() - at.getTime()).toBe(15 * 60_000);
  });
});

describe('[NFR-QUAL-006] parallel workers never collide', () => {
  it('the same seed on different Jest workers gets different run domains, e-mails, slugs and ids', () => {
    const w1 = createFactories({ seed: 'shared', workerId: '1' });
    const w2 = createFactories({ seed: 'shared', workerId: '2' });
    expect(w1.emailDomain).toMatch(/^r[0-9a-f]{10}\.test\.invalid$/);
    expect(w1.emailDomain).not.toBe(w2.emailDomain);
    expect(w1.user().email).not.toBe(w2.user().email);
    expect(w1.organisation().slug).not.toBe(w2.organisation().slug);
    expect(w1.user().id).not.toBe(w2.user().id);
  });

  it('within one worker every e-mail is unique and ends in @<run>.test.invalid', () => {
    const f = createFactories({ seed: 'many', workerId: '3' });
    const emails = Array.from({ length: 500 }, () => f.user().email);
    expect(new Set(emails).size).toBe(500);
    for (const email of emails) expect(email.endsWith(`@${f.emailDomain}`)).toBe(true);
  });

  it('the run token separates runs that share a seed and worker', () => {
    const a = runIdentity({ seed: 's', workerId: '1', runToken: 'a' });
    const b = runIdentity({ seed: 's', workerId: '1', runToken: 'b' });
    expect(a.emailDomain).not.toBe(b.emailDomain);
  });

  it('two test files sharing a seed on one worker (lane B runs in band) get different runs; the default is this file', () => {
    const base = { seed: 's', workerId: '1', runToken: '' };
    const a = runIdentity({ ...base, testFile: 'prisma/tests/a.int.test.ts' });
    const b = runIdentity({ ...base, testFile: 'prisma/tests/b.int.test.ts' });
    expect(a.run).not.toBe(b.run);
    expect(runIdentity(base).run).toBe(runIdentity({ ...base, testFile: 'tests/factories/factories.test.ts' }).run);
    expect(runIdentity(base).run).not.toBe(runIdentity({ ...base, testFile: '' }).run);
  });

  it('property: no id collides inside a worker over a few hundred records', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 16 }), (seed) => {
        const f = createFactories({ seed, workerId: '1' });
        const ids = Array.from({ length: 150 }, () => f.shipment().id);
        expect(new Set(ids).size).toBe(ids.length);
      }),
      { numRuns: 15, seed: 20261113 },
    );
  });
});

describe('factory records', () => {
  const f = createFactories({ seed: 'shape', workerId: '1' });

  it('produce well-formed, synthetic records for all eight entities', () => {
    const user = f.user();
    const quote = f.quote();
    const payment = f.payment();
    expect(user.id).toMatch(UUID_V7);
    expect(['en', 'es', 'fr']).toContain(user.locale);
    expect(quote.origin).not.toBe(quote.destination);
    expect(Number.isInteger(quote.price.amountMinor)).toBe(true);
    expect(quote.price.currency).toBe('USD');
    expect(payment.gatewayToken).toBe('mock_ok');
    expect(f.organisation().slug).toContain(f.run);
    expect(f.membership().role).toMatch(/^(OWNER|ADMIN|SHIPPER|FINANCE|VIEWER)$/);
    expect(f.shipment().trackingNumber).toMatch(/^MOCK[0-9]{10}$/);
    expect(f.order().status).toBe('PENDING_PAYMENT');
    expect(f.document().contentType).toBe('application/pdf');
  });

  it('overrides win over generated values and do not disturb the random stream', () => {
    const a = createFactories({ seed: 'ov', workerId: '1' });
    const b = createFactories({ seed: 'ov', workerId: '1' });
    expect(a.user({ displayName: 'Fixed Name' }).displayName).toBe('Fixed Name');
    b.user();
    expect(a.user().id).toBe(b.user().id);
  });
});
