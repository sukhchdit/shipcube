import { spawn } from 'node:child_process';
import * as dgram from 'node:dgram';
import { lookup } from 'node:dns';
import { resolve4 } from 'node:dns/promises';
import * as http2 from 'node:http2';
import { createConnection } from 'node:net';
import * as tls from 'node:tls';

declare function withTenantTx<T>(ctx: unknown, fn: (db: unknown) => Promise<T>): Promise<T>;

// PR44-SEC-04 X04-X08: the Node network and process modules and the global WebSocket are external I/O inside a
// tenant transaction (T-83) and egress outside OutboundHttpClient (NFR-SEC-010): two findings each.
export const probe = (ctx: unknown, host: string): Promise<void> =>
  withTenantTx(ctx, async () => {
    http2.connect(`https://${host}`).close();
    createConnection({ host, port: 443 }).end();
    tls.connect({ host, port: 443 }).end();
    dgram.createSocket('udp4').close();
    lookup(host, () => undefined);
    await resolve4(host);
    spawn('hostname').kill();
    new WebSocket(`wss://${host}`).close();
  });
