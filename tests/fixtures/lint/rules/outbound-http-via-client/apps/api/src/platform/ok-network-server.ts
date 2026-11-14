import { createSecureServer } from 'node:http2';
import type { AddressInfo } from 'node:net';
import * as net from 'node:net';
import { isIP } from 'node:net';

// PR44-SEC-04 (NFR-SEC-010): the listening side and the pure node:net helpers are not egress, and a type-only import
// never counts (positive control).
export const listen = (address: AddressInfo): boolean => {
  const secure = createSecureServer({});
  const plain = net.createServer();
  secure.close();
  plain.close();
  return isIP(address.address) !== 0 && net.isIPv6(address.address);
};
