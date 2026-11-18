/**
 * The worker entry point (D-ORCH-073, D-ARCH-136): main.ts starts startWorker with the production process (no
 * overrides) and hands a rejection to raiseStartupError. start-worker.ts is mocked, so importing main.ts starts nothing.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockStartWorker = jest.fn<(overrides?: object) => Promise<void>>();
const mockRaiseStartupError = jest.fn<(error: unknown) => void>();

jest.mock('./start-worker.js', () => ({ startWorker: mockStartWorker, raiseStartupError: mockRaiseStartupError }));

/** Evaluates main.ts afresh, then lets the startWorker promise settle. */
async function runMain(): Promise<void> {
  jest.resetModules();
  await import('./main.js');
  await new Promise((resolve) => setImmediate(resolve));
}

describe('[D-ORCH-073] apps/worker main.ts', () => {
  beforeEach(() => {
    mockStartWorker.mockReset();
    mockRaiseStartupError.mockReset();
  });

  it('calls startWorker once, with no overrides (the production process), and raises nothing when it resolves', async () => {
    mockStartWorker.mockResolvedValue(undefined);
    await runMain();
    expect(mockStartWorker.mock.calls).toEqual([[]]);
    expect(mockRaiseStartupError).not.toHaveBeenCalled();
  });

  it('hands a startWorker rejection to raiseStartupError (never swallowed)', async () => {
    const failure = new Error('unexpected composition error');
    mockStartWorker.mockRejectedValue(failure);
    await runMain();
    expect(mockStartWorker).toHaveBeenCalledTimes(1);
    expect(mockRaiseStartupError.mock.calls).toEqual([[failure]]);
  });
});
