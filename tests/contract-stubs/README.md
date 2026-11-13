# Contract stubs

Request handlers built from the examples in `docs/03-architecture/api/openapi.yaml` (TASK-017, US-034, ADR-0016 §1). A frontend task can run against the documented responses of an endpoint before the API task that implements it merges.

The stubs are built **at run time** from the dereferenced document (`tools/openapi/contract.ts`). Nothing generated is committed, so a stub can't drift from the contract: change the example in `openapi.yaml` and the stub changes with it. `contract-stubs.api.test.ts` checks every documented 2xx example of all 133 operations against the contract with the same validator the API tests use (`tests/api/helpers/contract-validator.ts`).

## Use

```sh
export PATH="$APPDATA/fnm/aliases/default:$PATH"
CONTRACT_STUB_PORT=4010 npm exec --no -- tsx --conditions=@platform/source tests/contract-stubs/serve.ts
```

- Binds `127.0.0.1:4010` by default (`CONTRACT_STUB_HOST`, `CONTRACT_STUB_PORT`; port `0` picks a free one). Point the Vite dev proxy for `/api` and `/health` at it.
- Each operation answers with its first 2xx response and that response's first example. 204 answers have no body.
- `Prefer: code=404` picks another documented status. For a shared problem response, the first example whose `code` the operation lists in `x-error-codes` is used.
- `Prefer: example=<name>` picks a named example, e.g. `Prefer: code=409, example=CONCURRENCY_CONFLICT`. An unknown status or example name returns 400 `MALFORMED_REQUEST` with the reason in `detail`.
- `X-Correlation-Id` is echoed when it matches `^[A-Za-z0-9-]{8,64}$`, otherwise a UUID is generated. Problem examples carry the request's path and correlation ID.
- Unknown route: 404 `NOT_FOUND`. Known path with another method: 405 `METHOD_NOT_ALLOWED` with `Allow`. Both are `application/problem+json`.

In code: `buildStubs(doc)`, `resolveStub(stubs, method, url, { operationId?, status?, exampleName? })` (`stubs.ts`), and `startContractStubServer({ port = 0, host = '127.0.0.1' })` returning `{ url, stubs, close() }` (`server.ts`).

## Limits

- Request bodies, parameters and auth aren't validated. Every request gets the selected example, so a stub never shows server-side behaviour (validation errors, state, pagination).
- `text/event-stream` examples are sent as one static body. Real SSE timing isn't simulated.
- `externalValue` examples aren't supported. The contract doesn't use them.
- No CORS headers: use the dev-server proxy (same origin).
- Local development and tests only. Nothing here is deployed.

## Tool choice and licence

Built in-house on `node:http` and the existing dev dependency `@apidevtools/swagger-parser` (MIT, already used by the contract tooling). No new dependency.

Rejected:

- **MSW (Mock Service Worker):** brings a new dependency tree (service-worker runtime, interceptors, GraphQL parser) for a feature this repo needs only in its simplest form. Its handlers would still have to be written or generated from the contract, and that's the part built here.
- **Stoplight Prism:** a large new dependency tree with its own OpenAPI parser and validator stack. It duplicates `swagger-parser` and Ajv, which the repository already uses. Every new tree has to pass the licence, vulnerability and 18-month maintenance rules (CLAUDE.md §5) on every audit.

The in-house server is about 200 lines. It shares path matching (`tests/api/helpers/path-match.ts`) and the dereferenced document with the response validator, so stubs and validation read the contract the same way.
