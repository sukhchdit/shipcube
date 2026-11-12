// Semgrep test fixture for .semgrep/outbound-http.yml (ADR-0016 §13, PR2-SEC-04 sink list). Never executed.
// ruleid: platform.outbound-http.client-library
import axios from 'axios';
// ruleid: platform.outbound-http.client-library
import * as undici from 'undici';
// ruleid: platform.outbound-http.client-library
import { got } from 'got';
// ok: platform.outbound-http.client-library
import type { AxiosResponse } from 'axios';
import http from 'node:http';
import * as https from 'https';
import { request as http2Request } from 'node:http2';
import { connect } from 'node:net';
import * as tls from 'node:tls';
import { createServer } from 'node:http';

export async function sinks(url: string): Promise<unknown[]> {
  // ruleid: platform.outbound-http.client-library
  const needle = require('needle');
  // ruleid: platform.outbound-http.client-library
  const ky = await import('ky');
  // ruleid: platform.outbound-http.node-network-call
  const viaHttp = http.request(url);
  // ruleid: platform.outbound-http.node-network-call
  const viaHttps = https.get(url);
  // ruleid: platform.outbound-http.node-network-call
  const viaHttp2 = http2Request(url);
  // ruleid: platform.outbound-http.node-network-call
  const viaNet = connect(443, 'example.invalid');
  // ruleid: platform.outbound-http.node-network-call
  const viaTls = tls.connect(443, 'example.invalid');
  // ruleid: platform.outbound-http.node-network-call
  const dynamicHttps = await import('node:https');
  // ok: platform.outbound-http.node-network-call
  const server = createServer();
  // ruleid: platform.outbound-http.global-fetch-or-socket
  const direct = await fetch(url);
  // ruleid: platform.outbound-http.global-fetch-or-socket
  const alias = fetch;
  // ruleid: platform.outbound-http.global-fetch-or-socket
  const viaGlobal = await globalThis.fetch(url);
  // ruleid: platform.outbound-http.global-fetch-or-socket
  const viaIndex = (globalThis as unknown as Record<string, typeof fetch>)['fetch'];
  // ruleid: platform.outbound-http.global-fetch-or-socket
  const socket = new WebSocket(url);
  // ruleid: platform.outbound-http.global-fetch-or-socket
  const events = new EventSource(url);
  // ok: platform.outbound-http.global-fetch-or-socket
  const client = { fetch: (target: string) => target };
  // ok: platform.outbound-http.global-fetch-or-socket
  const viaClient = client.fetch(url);
  const typed: AxiosResponse | undefined = undefined;
  return [axios, undici, got, needle, ky, viaHttp, viaHttps, viaHttp2, viaNet, viaTls, dynamicHttps, server, direct];
  void [alias, viaGlobal, viaIndex, socket, events, viaClient, typed];
}
