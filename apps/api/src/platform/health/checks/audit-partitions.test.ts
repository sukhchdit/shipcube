import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import {
  AUDIT_PARTITION_NAME,
  createAuditPartitionsCheck,
  evaluatePartitions,
  isPartitionsUnavailable,
  partitionNameFor,
  type PartitionCatalogueRow,
  type SquattedObject,
} from './audit-partitions.js';

const NOW = new Date('2026-11-13T10:00:00Z');
const partition = (name: string, overrides: Partial<PartitionCatalogueRow> = {}): PartitionCatalogueRow => ({
  name,
  kind: 'r',
  attached: true,
  detach_pending: false,
  audit_owned: true,
  ...overrides,
});
/** current .. current + offsetMax verified partitions. */
const healthy = (now: Date, upTo = 3): PartitionCatalogueRow[] =>
  Array.from({ length: upTo + 1 }, (_, offset) => partition(partitionNameFor(now, offset)));

describe('audit_partitions readiness: contiguity from the catalogue (data-model §5.3 item 3, PR12-SEC-02, D-ARCH-076)', () => {
  it('names the UTC months, across a year boundary', () => {
    expect(partitionNameFor(NOW, 0)).toBe('audit_entries_2026_11');
    expect(partitionNameFor(NOW, 2)).toBe('audit_entries_2027_01');
    expect(partitionNameFor(new Date('2026-12-31T23:59:59-03:00'), 0)).toBe('audit_entries_2027_01');
  });

  it('[AT-US-012-02] current .. current + 3 verified → ok', () => {
    expect(evaluatePartitions(healthy(NOW), NOW)).toEqual({ status: 'ok', missing: [], late: false, squatted: [] });
  });

  it('[AT-US-012-04] only current + 3 missing (the daily job is late) → degraded, readiness stays 200', () => {
    expect(evaluatePartitions(healthy(NOW, 2), NOW)).toMatchObject({ status: 'degraded', missing: [], late: true });
  });

  it.each([0, 1, 2])('[PR12-SEC-02 item 3] month current + %i missing → unavailable (the < 2 count rule could never fire)', (gap) => {
    const rows = healthy(NOW).filter((row) => row.name !== partitionNameFor(NOW, gap));
    expect(evaluatePartitions(rows, NOW)).toMatchObject({ status: 'unavailable', missing: [partitionNameFor(NOW, gap)] });
  });

  it.each<[string, Partial<PartitionCatalogueRow>, SquattedObject['reason']]>([
    ['an index of the migrator (relkind i)', { kind: 'i', attached: false, audit_owned: false }, 'not_a_table'],
    ['a view', { kind: 'v', attached: false, audit_owned: false }, 'not_a_table'],
    ['a sequence', { kind: 'S', attached: false, audit_owned: false }, 'not_a_table'],
    ['a free-standing type (enum, domain)', { kind: 'type', attached: false, audit_owned: false }, 'not_a_table'],
    ['a detached plain table', { attached: false }, 'not_attached'],
    ['a partition pending DETACH CONCURRENTLY', { detach_pending: true }, 'detach_pending'],
    ['an attached partition owned by someone else', { audit_owned: false }, 'foreign_owner'],
  ])('[PR12-SEC-02] %s under a far-future partition name → unavailable + squat', (_label, overrides, reason) => {
    const squat = partition('audit_entries_2099_02', overrides);
    expect(evaluatePartitions([...healthy(NOW), squat], NOW)).toEqual({
      status: 'unavailable',
      missing: [],
      late: false,
      squatted: [{ name: 'audit_entries_2099_02', kind: squat.kind, reason }],
    });
  });

  it('[PR12-SEC-02] a squatter on a REQUIRED month makes it missing and squatted at once', () => {
    const name = partitionNameFor(NOW, 1);
    const rows = [...healthy(NOW).filter((row) => row.name !== name), partition(name, { kind: 'i', attached: false })];
    expect(evaluatePartitions(rows, NOW)).toMatchObject({
      status: 'unavailable',
      missing: [name],
      squatted: [{ name, reason: 'not_a_table' }],
    });
  });

  it('a relation and a type sharing a name are both reported (duplicate_name), never verified', () => {
    const name = partitionNameFor(NOW, 0);
    const rows = [...healthy(NOW), partition(name, { kind: 'type', attached: false, audit_owned: false })];
    const evaluation = evaluatePartitions(rows, NOW);
    expect(evaluation.status).toBe('unavailable');
    expect(evaluation.missing).toEqual([name]);
    expect(evaluation.squatted.map((object) => object.reason)).toEqual(['duplicate_name', 'duplicate_name']);
  });

  it('ignores rows whose name is not a partition name (defensive at the boundary)', () => {
    expect(evaluatePartitions([...healthy(NOW), partition('audit_entries_2026_11_pkey', { kind: 'i' })], NOW).status).toBe('ok');
  });

  it('property: status is ok iff the required and expected months are verified and nothing is squatted', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2026-01-01T00:00:00Z'), max: new Date('2090-01-01T00:00:00Z'), noInvalidDate: true }),
        fc.subarray([0, 1, 2, 3, 4, 5]),
        (now, present) => {
          const evaluation = evaluatePartitions(
            present.map((offset) => partition(partitionNameFor(now, offset))),
            now,
          );
          const required = [0, 1, 2].every((offset) => present.includes(offset));
          expect(evaluation.status).toBe(!required ? 'unavailable' : present.includes(3) ? 'ok' : 'degraded');
          evaluation.missing.forEach((name) => expect(name).toMatch(AUDIT_PARTITION_NAME));
        },
      ),
    );
  });
});

describe('createAuditPartitionsCheck', () => {
  const reader = (rows: readonly unknown[]) => {
    let calls = 0;
    return {
      query: () => {
        calls += 1;
        return Promise.resolve({ rows });
      },
      calls: () => calls,
    };
  };

  it('resolves for ok, resolves "degraded" when late, rejects (never shows details) when unavailable', async () => {
    const signal = new AbortController().signal;
    await expect(
      createAuditPartitionsCheck(reader(healthy(NOW)), { onSquatted: () => undefined, now: () => NOW }).check(signal),
    ).resolves.toBeUndefined();
    await expect(
      createAuditPartitionsCheck(reader(healthy(NOW, 2)), { onSquatted: () => undefined, now: () => NOW }).check(signal),
    ).resolves.toBe('degraded');
    const error: unknown = await createAuditPartitionsCheck(reader(healthy(NOW, 1)), { onSquatted: () => undefined, now: () => NOW })
      .check(signal)
      .then(
        () => undefined,
        (reason: unknown) => reason,
      );
    expect(isPartitionsUnavailable(error)).toBe(true);
  });

  it('[PR12-SEC-02] emits audit_partition_squatted once per object, not once per poll', async () => {
    let clock = NOW.getTime();
    const events: SquattedObject[] = [];
    const source = reader([...healthy(NOW), partition('audit_entries_2099_02', { kind: 'i', attached: false })]);
    const check = createAuditPartitionsCheck(source, {
      onSquatted: (object) => events.push(object),
      now: () => new Date(clock),
      intervalMs: 10,
    });
    const signal = new AbortController().signal;
    await expect(check.check(signal)).rejects.toThrow('audit partitions not ready');
    clock += 50;
    await expect(check.check(signal)).rejects.toThrow('audit partitions not ready');
    expect(source.calls()).toBe(2);
    expect(events).toEqual([{ name: 'audit_entries_2099_02', kind: 'i', reason: 'not_a_table' }]);
  });

  it('reads the catalogue on the slow interval only (cached result reused)', async () => {
    const source = reader(healthy(NOW));
    const check = createAuditPartitionsCheck(source, { onSquatted: () => undefined, now: () => NOW });
    const signal = new AbortController().signal;
    await check.check(signal);
    await check.check(signal);
    expect(source.calls()).toBe(1);
  });

  it('refuses an unexpected row shape and an aborted signal', async () => {
    const signal = new AbortController().signal;
    await expect(createAuditPartitionsCheck(reader([{ name: 1 }]), { onSquatted: () => undefined }).check(signal)).rejects.toThrow(
      TypeError,
    );
    const aborted = AbortSignal.abort();
    await expect(createAuditPartitionsCheck(reader(healthy(NOW)), { onSquatted: () => undefined }).check(aborted)).rejects.toBeDefined();
  });
});
