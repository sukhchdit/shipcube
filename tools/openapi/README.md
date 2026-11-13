# tools/openapi: contract-first tooling (TASK-017)

The contract is `docs/03-architecture/api/openapi.yaml` (REQ-API-002); conventions in `docs/03-architecture/api/README.md`.

| Command | What it does |
|---|---|
| `npm run openapi:lint` | Redocly CLI 2 lint with `redocly.yaml` (telemetry and update check off). Exit 0 = no errors; the accepted warnings are listed in `redocly.yaml`. |
| `npm run openapi:types` | Regenerates `packages/shared/src/api/types.gen.ts` (openapi-typescript 7, `alphabetize` + `immutable`, Prettier-formatted). Commit the result with the contract change. |
| `npm run openapi:types -- --check` | Exits 1 printing `stale: packages/shared/src/api/types.gen.ts` when the committed file does not match the contract (AT-US-035-03). |

## Route/document drift (`drift.ts`; suite `tests/generated/contract-drift.test.ts`)

The unit suite builds the composed app (`createApp` with the real health routes, the module registry and the docs UI;
`tests/generated/api-mounts.ts`, which reaches apps/api through TypeScript project references) and walks its router stack from the top. Routers mounted under a path are resolved only against the
literal mount paths app.ts uses (`/api/v1`, `/api/docs`); `/api/docs` is the one explicit exclusion (api/README.md
§15). Middleware mounted without a path is skipped (it serves no route). The test fails, naming `METHOD path`, on:

- a mounted route the document lacks (`undocumented-route`), or a layer the walker cannot resolve
  (`unrecognised-route`): a router or a handler mounted under any other path (`router.use('/webhooks/x', handler)`
  included), an array, optional-group or prefix mount of a literal mount path, an Express sub-app (wrapped by an app, or path-less on a Router),
  RegExp route paths,
  `all()` and optional/wildcard paths. A RegExp mount or route path (a literal, `new RegExp(...)` or `RegExp(...)`
  passed to `.use/.get/.post/.put/.patch/.delete/.all/.route/.head/.options`) is refused in `apps/api/src` by the lint
  (`no-restricted-syntax`, PR #32 m5); the walker additionally reports (`unrecognised-route`) a resolved layer whose
  matcher captures parameters or was built from a RegExp at all (it can accept paths outside its literal prefix: a
  non-capturing group, a character class or an alternation such as `/^\/api\/v[12]/` or `/^\/api\/v1|^\/hidden/`);
- the implemented-operations ledger disagreeing with what is mounted (`not-mounted`, `not-in-ledger`, `unknown-ledger-entry`);
- any documented operation without a success/request example, a non-empty `x-error-codes`, an `x-permission` (with a
  justification for `public`/`authenticated`), a unique camelCase `operationId`, `x-requirements` (REQ IDs),
  `x-milestone` (M0-M5) and `x-moscow` (Must/Should/Could) (`missing-traceability`, §15 rule 7), or an `x-sunset` when
  deprecated; and a mounted deprecated operation whose `x-sunset` has passed (checked against the real clock).

### The ledger: `implemented-operations.json`

`operations` lists the operationIds that must be mounted now. The check enforces both directions (every mounted,
documented operation is listed; every listed operation is mounted). Adding entries only is a **process rule, not a
mechanism**: the task that mounts an operation adds its operationId in the same change, and removing an entry together
with its route is a breaking change under the contract change process (api/README.md §18). That change is caught by the
lane A `openapi-breaking` step (`tools/ci/openapi-breaking.mjs`, oasdiff against the latest `v*` release tag;
NFR-MAINT-004, D-ORCH-024 (4)), which fails unless the PR carries the §18 deprecation record. TASK-020 (`defineRoute` route registry) may replace the ledger and adds the
metadata comparison of api/README.md §15 (x-permission equality, x-audit, x-idempotency, Joi parity).
