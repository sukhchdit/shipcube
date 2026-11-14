/**
 * The API entry point (D-ORCH-073): main.ts starts startApi with the production process (no overrides) and hands a
 * rejection to raiseStartupError. start-api.ts is mocked, so importing main.ts starts nothing.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockStartApi = jest.fn<(overrides?: object) => Promise<void>>();
const mockRaiseStartupError = jest.fn<(error: unknown) => void>();

jest.mock('./start-api.js', () => ({ startApi: mockStartApi, raiseStartupError: mockRaiseStartupError }));

/** Evaluates main.ts afresh, then lets the startApi promise settle. */
async function runMain(): Promise<void> {
  jest.resetModules();
  await import('./main.js');
  await new Promise((resolve) => setImmediate(resolve));
}

describe('[D-ORCH-073] apps/api main.ts', () => {
  beforeEach(() => {
    mockStartApi.mockReset();
    mockRaiseStartupError.mockReset();
  });

  it('calls startApi once, with no overrides (the production process), and raises nothing when it resolves', async () => {
    mockStartApi.mockResolvedValue(undefined);
    await runMain();
    expect(mockStartApi.mock.calls).toEqual([[]]);
    expect(mockRaiseStartupError).not.toHaveBeenCalled();
  });

  it('hands a startApi rejection to raiseStartupError (never swallowed)', async () => {
    const failure = new Error('unexpected composition error');
    mockStartApi.mockRejectedValue(failure);
    await runMain();
    expect(mockStartApi).toHaveBeenCalledTimes(1);
    expect(mockRaiseStartupError.mock.calls).toEqual([[failure]]);
  });
});
