# tools/openapi: contract-first tooling (TASK-017)

The contract is `docs/03-architecture/api/openapi.yaml` (REQ-API-002); conventions in `docs/03-architecture/api/README.md`.

| Command | What it does |
|---|---|
| `npm run openapi:lint` | Redocly CLI 2 lint with `redocly.yaml` (telemetry and update check off). Exit 0 = no errors; the accepted warnings are listed in `redocly.yaml`. |
| `npm run openapi:types` | Regenerates `packages/shared/src/api/types.gen.ts` (openapi-typescript 7, `alphabetize` + `immutable`, Prettier-formatted). Commit the result with the contract change. |
| `npm run openapi:types -- --check` | Exits 1 printing `stale: packages/shared/src/api/types.gen.ts` when the committed file does not match the contract (AT-US-035-03). |

## Route/document drift (`drift.ts`, `drift.test.ts`)

The unit test builds the composed app (`createApp` with the real health router, the module registry and the docs UI;
`api-mounts.ts`) and walks its router stack from the top. Routers mounted under a path are resolved only against the
literal mount paths app.ts uses (`/api/v1`, `/api/docs`); `/api/docs` is the one explicit exclusion (api/README.md
§15). Middleware mounted without a path is skipped (it serves no route). The test fails, naming `METHOD path`, on:

- a mounted route the document lacks (`undocumented-route`), or a layer the walker cannot resolve
  (`unrecognised-route`): a router or a handler mounted under any other path (`router.use('/webhooks/x', handler)`
  included), arrays, RegExps, `all()` and optional/wildcard paths;
- the implemented-operations ledger disagreeing with what is mounted (`not-mounted`, `not-in-ledger`, `unknown-ledger-entry`);
- any documented operation without a success/request example, a non-empty `x-error-codes`, an `x-permission` (with a
  justification for `public`/`authenticated`), a unique camelCase `operationId`, `x-requirements` (REQ IDs),
  `x-milestone` (M0-M5) and `x-moscow` (Must/Should/Could) (`missing-traceability`, §15 rule 7), or an `x-sunset` when
  deprecated; and a mounted deprecated operation whose `x-sunset` has passed (checked against the real clock).

### The ledger: `implemented-operations.json`

`operations` lists the operationIds that must be mounted now. The check enforces both directions (every mounted,
documented operation is listed; every listed operation is mounted). Adding entries only is a **process rule, not a
mechanism**: the task that mounts an operation adds its operationId in the same change, and removing an entry together
with its route is a breaking change under the contract change process (api/README.md §18), detected by the `oasdiff`
gate once it lands (NFR-MAINT-004). TASK-020 (`defineRoute` route registry) may replace the ledger and adds the
metadata comparison of api/README.md §15 (x-permission equality, x-audit, x-idempotency, Joi parity).
