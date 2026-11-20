/**
 * "Network access is monitored" (US-121 scenarios 3 and 7): counts outbound connection attempts while a test runs.
 * Every Node client path (node:http, node:https, node:tls, undici behind `fetch`) opens its connection through
 * `net.Socket.prototype.connect`, and `fetch` is spied as well, so a count of zero means no request left the process.
 * Attempts are refused (the spies throw) rather than passed through, so a failing guard cannot reach a real host.
 */
import { Socket } from 'node:net';

import { jest } from '@jest/globals';

export interface NetworkMonitor {
  /** Outbound attempts seen since the monitor started. */
  attempts(): number;
  restore(): void;
}

export function monitorNetwork(): NetworkMonitor {
  let count = 0;
  const refuse = (): never => {
    count += 1;
    throw new Error('network access attempted under the network monitor');
  };
  const connect = jest.spyOn(Socket.prototype, 'connect').mockImplementation(refuse);
  const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(refuse);
  return {
    attempts: () => count,
    restore: () => {
      connect.mockRestore();
      fetchSpy.mockRestore();
    },
  };
}
