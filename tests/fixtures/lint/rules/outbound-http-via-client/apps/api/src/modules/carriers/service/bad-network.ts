import { execFile } from 'node:child_process';
import * as dgram from 'node:dgram';
import dns from 'node:dns';
import { resolve6 } from 'node:dns/promises';
import { connect as connect2 } from 'node:http2';
import * as net from 'node:net';
import { connect as connectTls } from 'node:tls';

// PR44-SEC-04 X04-X08 (NFR-SEC-010): network and process egress outside OutboundHttpClient, outside any tenant
// transaction (only the SSRF rule fires): http2, net, tls, dgram, dns, dns/promises, child_process (named and
// dynamic import), the global WebSocket (bare and globalThis).
export const egress = async (host: string): Promise<void> => {
  connect2(`https://${host}`).close();
  new net.Socket().connect(443, host).end();
  net.connect(443, host).end();
  connectTls({ host, port: 443 }).end();
  dgram.createSocket('udp6').close();
  dns.lookup(host, () => undefined);
  await resolve6(host);
  execFile('hostname', () => undefined);
  const processes = await import('node:child_process');
  processes.spawn('hostname').kill();
  new WebSocket(`wss://${host}`).close();
  new globalThis.WebSocket(`wss://${host}`).close();
};
