// Worker log context (US-008 AT-US-008-03 worker part; TASK-010). Lines written while a job runs carry the job's
// correlation ID; lines outside a job carry null; a malformed correlation ID is refused.
import { describe, expect, it } from '@jest/globals';
import { createRuntimeLog } from '@platform/api/runtime';

import { JobContextError, jobLogContext, runWithJobContext } from './job-context.js';

function capture() {
  const raw: string[] = [];
  const log = createRuntimeLog('worker', { write: (line: string) => raw.push(line) }, { context: jobLogContext });
  return { log, lines: () => raw.map((line) => JSON.parse(line) as Record<string, unknown>) };
}

describe('worker job log context', () => {
  it('[AT-US-008-03] (worker part) lines written while a job runs carry the booking correlation ID', async () => {
    const { log, lines } = capture();
    log.info('worker.idle');
    await runWithJobContext({ correlationId: 'demo-booking-0001', orgId: 'org-1', actorId: 'user-1' }, async () => {
      log.info('job.started', { queue: 'booking' });
      await Promise.resolve();
      log.info('job.completed', { queue: 'booking' });
    });
    expect(lines().map((line) => [line['event'], line['correlation_id'], line['org_id'], line['actor_id']])).toEqual([
      ['worker.idle', null, null, null],
      ['job.started', 'demo-booking-0001', 'org-1', 'user-1'],
      ['job.completed', 'demo-booking-0001', 'org-1', 'user-1'],
    ]);
  });

  it('is undefined outside a job and omits ids that the job context does not have', () => {
    expect(jobLogContext()).toBeUndefined();
    expect(runWithJobContext({ correlationId: 'abc-12345678' }, jobLogContext)).toEqual({ correlationId: 'abc-12345678' });
  });

  it('refuses a correlation ID outside the ADR-0016 §15 pattern', () => {
    expect(() => runWithJobContext({ correlationId: 'bad id!' }, () => 1)).toThrow(JobContextError);
    expect(() => runWithJobContext({ correlationId: 'x'.repeat(65) }, () => 1)).toThrow(JobContextError);
  });
});
