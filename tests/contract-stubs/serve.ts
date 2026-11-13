// CLI for the contract stub server (TASK-017 sheet item, US-034):
//   npm exec --no -- tsx --conditions=@platform/source tests/contract-stubs/serve.ts
// Port from CONTRACT_STUB_PORT (default 4010), host from CONTRACT_STUB_HOST (default 127.0.0.1). Stops on SIGINT/SIGTERM.
import { startContractStubServer } from './server.js';

const DEFAULT_PORT = 4010;

function portFromEnv(value: string | undefined): number {
  if (value === undefined || value === '') return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new RangeError(`CONTRACT_STUB_PORT must be 0-65535, got "${value}"`);
  return port;
}

const server = await startContractStubServer({
  port: portFromEnv(process.env['CONTRACT_STUB_PORT']),
  host: process.env['CONTRACT_STUB_HOST'] ?? '127.0.0.1',
});
process.stdout.write(`${JSON.stringify({ event: 'contract_stubs.listening', url: server.url, operations: server.stubs.length })}\n`);

const stop = (): void => {
  void server.close().then(() => process.exit(0));
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
