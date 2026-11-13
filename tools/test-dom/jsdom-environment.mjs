/**
 * Jest environment for the `unit-dom` project: jest-environment-jsdom plus the Fetch API and encoding globals that
 * jsdom leaves out and react-router needs (Request, Response, Headers, AbortSignal, TextEncoder). The values come from
 * the Node realm that loads this file, so `new Request(url, { signal })` accepts the same AbortSignal class it was
 * built with. Jest loads environments without a transform, hence plain JavaScript (ESM, loaded by Jest's
 * `requireOrImportModule`).
 */
import { TestEnvironment } from 'jest-environment-jsdom';

const NODE_GLOBALS = /** @type {const} */ ([
  'AbortController',
  'AbortSignal',
  'fetch',
  'Headers',
  'ReadableStream',
  'Request',
  'Response',
  'TextDecoder',
  'TextEncoder',
]);

export default class JsdomWithFetchEnvironment extends TestEnvironment {
  /**
   * @param {ConstructorParameters<typeof TestEnvironment>[0]} config
   * @param {ConstructorParameters<typeof TestEnvironment>[1]} context
   */
  constructor(config, context) {
    super(config, context);
    Object.assign(this.global, Object.fromEntries(NODE_GLOBALS.map((name) => [name, globalThis[name]])));
  }
}
