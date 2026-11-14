import type { AddressInfo } from 'node:net';
import * as net from 'node:net';
import { BlockList, isIP } from 'node:net';

declare function withTenantTx<T>(ctx: unknown, fn: (db: unknown) => Promise<T>): Promise<T>;

// PR44-SEC-04: the pure node:net helpers do no I/O, and a type-only import is never a source (positive control for
// both T-83 and NFR-SEC-010; apps/api/src/platform/valkey/options.ts imports isIP).
export const classify = (ctx: unknown, address: AddressInfo): Promise<boolean> =>
  withTenantTx(ctx, async () => {
    const blocked = new BlockList();
    blocked.addAddress('192.0.2.1');
    return isIP(address.address) !== 0 && net.isIPv4(address.address) && !blocked.check(address.address);
  });
