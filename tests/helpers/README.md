# Test harness (TASK-276, T-QA-03)

Shared support for the Jest projects. Everything here is deterministic: fixed clock, seeded RNG, derived sentinels.

| Piece                                              | Use                                                                                                                                                                                      |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/factories` (`createFactories({ seed })`)    | Typed records for user, organisation, membership, quote, shipment, order, payment, document. E-mails end in `@<run>.test.invalid`; `<run>` differs per seed, Jest worker and `TEST_RUN_ID`. |
| `tests/helpers/fake-clock.ts`                      | `createManualClock()` for injected clocks, `installFakeClock()` / `withFakeClock()` for Jest modern fake timers pinned to a fixed instant.                                                  |
| `tests/helpers/sentinels.ts`                       | Fixed sentinel PII and secret values (name, e-mail, tax id, token, secret, Luhn-valid `4242` PAN), derived at load time, never written out as literals.                                     |
| `tests/helpers/leakage-scanner.ts`                 | `scanForLeaks`, `expectNoLeaks`, `useLeakageGuard()` (an `afterEach` that fails a test whose captured logs contain a sentinel). Findings carry ids and paths, never the value.            |
| `tests/helpers/mock-scenario.ts`                   | `mockScenario({ latencyMs, fail, error, ratesEmpty, track })` builds the `X-Mock-Scenario` header and the `MOCK:` customer reference; `parseMockScenario` mirrors the API rules.          |
| `apps/api/src/platform/db/query-counter.ts`        | Prisma query counter: `withQueryCounter(client, counter)` plus `counter.middleware()`; read `counter.requests()` and call `assertQueryBudget(report, 12)` (NFR-PERF-006).                  |

## Running suites

- `npm run test:unit`, `test:integration`, `test:api` and `test:generated` select one Jest project each (`unit` and `unit-dom`, `integration`, `api`, `generated`).
- The `generated` project owns every test file under `tests/generated/`; the other four projects ignore that folder, so a generated suite never runs twice.
- **Put the test path BEFORE `--selectProjects`.** The flag is variadic: `jest.js --selectProjects integration <path>` treats the path as a second project name and runs every integration suite. Use `jest.js <path> --selectProjects integration`; `npm run test:integration -- <path>` has the same problem because the script ends in `--selectProjects integration` (SPK-03 F-12).
- Tests that need a directory create it with `mkdtemp` and delete only that directory (D-ORCH-038).
