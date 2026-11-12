# tools/openapi: contract-first tooling (TASK-017)

The contract is `docs/03-architecture/api/openapi.yaml` (REQ-API-002); conventions in `docs/03-architecture/api/README.md`.

| Command | What it does |
|---|---|
| `npm run openapi:lint` | Redocly CLI 2 lint with `redocly.yaml` (telemetry and update check off). Exit 0 = no errors; the accepted warnings are listed in `redocly.yaml`. |
| `npm run openapi:types` | Regenerates `packages/shared/src/api/types.gen.ts` (openapi-typescript 7, `alphabetize` + `immutable`, Prettier-formatted). Commit the result with the contract change. |
| `npm run openapi:types -- --check` | Exits 1 printing `stale: packages/shared/src/api/types.gen.ts` when the committed file does not match the contract (AT-US-035-03). |

## Route/document drift (`drift.ts`, `drift.test.ts`)

The unit test walks the mounted routers (health at the root, every `moduleRegistry` router under `/api/v1`) and fails,
naming `METHOD path`, on:

- a mounted route the document lacks (`undocumented-route`) or a router layer the walker cannot resolve (`unrecognised-route`);
- the implemented-operations ledger disagreeing with what is mounted (`not-mounted`, `not-in-ledger`, `unknown-ledger-entry`);
- any documented operation without a success/request example, a non-empty `x-error-codes`, an `x-permission` (with a
  justification for `public`/`authenticated`), a unique camelCase `operationId`, or an `x-sunset` when deprecated;
  and a mounted deprecated operation whose `x-sunset` has passed.

### The ledger: `implemented-operations.json`

`operations` lists the operationIds that must be mounted now. **Append-only:** the task that mounts an operation adds
its operationId in the same change. Removing an entry needs the contract change process (api/README.md §18). TASK-020
(`defineRoute` route registry) may replace the ledger and adds the metadata comparison (x-audit, x-idempotency,
Joi parity) of api/README.md §15.
