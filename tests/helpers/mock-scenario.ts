/**
 * Mock carrier scenario helper (REQ-CARR-005, DR-B29; TEST-STRATEGY §10.1 rule 8; T-QA-03).
 *
 * Builds and validates the `X-Mock-Scenario` directive string: semicolon-separated `key=value` pairs, for example
 * `latency=6000;fail=booking`. The same string is accepted from a shipment customer reference that begins with
 * `MOCK:`. Vocabulary (DR-B29): `latency` (0..30000 ms), `fail` (rates, booking, void, pickup, cancel_pickup, track;
 * repeatable), `error` (a canonical error code), `rates=empty`, `track` (happy_path, customs_hold, exception,
 * return_to_sender, delayed, unknown_number). Unknown keys or out-of-range values are rejected the way the API rejects
 * them (400 `MOCK_SCENARIO_INVALID`), so tests can also build invalid directives on purpose via {@link rawScenario}.
 *
 * Rendering is canonical (fixed key order, `fail` values sorted), so one scenario is always one string.
 */

export const MOCK_SCENARIO_HEADER = 'X-Mock-Scenario';
export const MOCK_REFERENCE_PREFIX = 'MOCK:';
export const MOCK_LATENCY_MAX_MS = 30_000;

export const MOCK_FAIL_OPERATIONS = ['rates', 'booking', 'void', 'pickup', 'cancel_pickup', 'track'] as const;
export const MOCK_TRACK_OUTCOMES = ['happy_path', 'customs_hold', 'exception', 'return_to_sender', 'delayed', 'unknown_number'] as const;

export type MockFailOperation = (typeof MOCK_FAIL_OPERATIONS)[number];
export type MockTrackOutcome = (typeof MOCK_TRACK_OUTCOMES)[number];

export interface MockScenario {
  readonly latencyMs?: number;
  readonly fail?: readonly MockFailOperation[];
  /** A canonical carrier error code, returned with the failure (UPPER_SNAKE_CASE). */
  readonly error?: string;
  readonly ratesEmpty?: boolean;
  readonly track?: MockTrackOutcome;
}

export class MockScenarioError extends Error {
  readonly code = 'MOCK_SCENARIO_INVALID';
  constructor(message: string) {
    super(message);
    this.name = 'MockScenarioError';
  }
}

const ERROR_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const isMember = <T extends string>(list: readonly T[], value: string): value is T => (list as readonly string[]).includes(value);

/** Validates a scenario object and renders the canonical directive string. */
export function renderMockScenario(scenario: MockScenario): string {
  const parts: string[] = [];
  if (scenario.latencyMs !== undefined) {
    if (!Number.isInteger(scenario.latencyMs) || scenario.latencyMs < 0 || scenario.latencyMs > MOCK_LATENCY_MAX_MS) {
      throw new MockScenarioError(`latency must be an integer 0..${MOCK_LATENCY_MAX_MS} ms`);
    }
    parts.push(`latency=${scenario.latencyMs}`);
  }
  for (const operation of [...new Set(scenario.fail ?? [])].sort()) {
    if (!isMember(MOCK_FAIL_OPERATIONS, operation)) throw new MockScenarioError('fail names an unknown operation');
    parts.push(`fail=${operation}`);
  }
  if (scenario.error !== undefined) {
    if (!ERROR_CODE.test(scenario.error)) throw new MockScenarioError('error must be an UPPER_SNAKE_CASE canonical code');
    parts.push(`error=${scenario.error}`);
  }
  if (scenario.ratesEmpty === true) parts.push('rates=empty');
  if (scenario.track !== undefined) {
    if (!isMember(MOCK_TRACK_OUTCOMES, scenario.track)) throw new MockScenarioError('track names an unknown outcome');
    parts.push(`track=${scenario.track}`);
  }
  return parts.join(';');
}

/** Parses a directive string with the API's rules; throws {@link MockScenarioError} on anything outside the vocabulary. */
export function parseMockScenario(directive: string): MockScenario {
  const text = directive.startsWith(MOCK_REFERENCE_PREFIX) ? directive.slice(MOCK_REFERENCE_PREFIX.length) : directive;
  let latencyMs: number | undefined;
  const fail: MockFailOperation[] = [];
  let error: string | undefined;
  let ratesEmpty = false;
  let track: MockTrackOutcome | undefined;
  const seen = new Set<string>();
  for (const raw of text.split(';')) {
    if (raw === '') continue;
    const eq = raw.indexOf('=');
    if (eq <= 0) throw new MockScenarioError('directive must be key=value');
    const key = raw.slice(0, eq);
    const value = raw.slice(eq + 1);
    if (key !== 'fail') {
      if (seen.has(key)) throw new MockScenarioError(`directive ${key} is repeated`);
      seen.add(key);
    }
    switch (key) {
      case 'latency': {
        if (!/^[0-9]{1,5}$/.test(value) || Number(value) > MOCK_LATENCY_MAX_MS) {
          throw new MockScenarioError(`latency must be 0..${MOCK_LATENCY_MAX_MS} ms`);
        }
        latencyMs = Number(value);
        break;
      }
      case 'fail': {
        if (!isMember(MOCK_FAIL_OPERATIONS, value)) throw new MockScenarioError('fail names an unknown operation');
        if (!fail.includes(value)) fail.push(value);
        break;
      }
      case 'error': {
        if (!ERROR_CODE.test(value)) throw new MockScenarioError('error must be an UPPER_SNAKE_CASE canonical code');
        error = value;
        break;
      }
      case 'rates': {
        if (value !== 'empty') throw new MockScenarioError('rates only accepts "empty"');
        ratesEmpty = true;
        break;
      }
      case 'track': {
        if (!isMember(MOCK_TRACK_OUTCOMES, value)) throw new MockScenarioError('track names an unknown outcome');
        track = value;
        break;
      }
      default:
        throw new MockScenarioError(`unknown directive ${key.slice(0, 32)}`);
    }
  }
  return {
    ...(latencyMs === undefined ? {} : { latencyMs }),
    ...(fail.length === 0 ? {} : { fail: [...fail].sort() }),
    ...(error === undefined ? {} : { error }),
    ...(ratesEmpty ? { ratesEmpty } : {}),
    ...(track === undefined ? {} : { track }),
  };
}

export interface BuiltMockScenario {
  readonly scenario: MockScenario;
  /** Canonical directive string. */
  readonly directive: string;
  /** `{ 'X-Mock-Scenario': directive }`, ready for `supertest.set(headers)` or `fetch({ headers })`. */
  readonly headers: Readonly<Record<typeof MOCK_SCENARIO_HEADER, string>>;
  /** `MOCK:<directive>`: the customer-reference form. */
  readonly customerReference: string;
}

/** Builds a validated scenario with its header and customer-reference forms. */
export function mockScenario(scenario: MockScenario = {}): BuiltMockScenario {
  const directive = renderMockScenario(scenario);
  return {
    scenario,
    directive,
    headers: { [MOCK_SCENARIO_HEADER]: directive },
    customerReference: `${MOCK_REFERENCE_PREFIX}${directive}`,
  };
}

/** Header object for an arbitrary string, UNVALIDATED: negative tests for MOCK_SCENARIO_INVALID. */
export function rawScenario(directive: string): Readonly<Record<typeof MOCK_SCENARIO_HEADER, string>> {
  return { [MOCK_SCENARIO_HEADER]: directive };
}

/** Named scenarios used across suites (names follow the PRD/story wording). */
export const MOCK_SCENARIOS = Object.freeze({
  slowCarrier: mockScenario({ latencyMs: 6_000 }),
  bookingFails: mockScenario({ fail: ['booking'] }),
  voidFails: mockScenario({ fail: ['void'] }),
  noRates: mockScenario({ ratesEmpty: true }),
  trackingException: mockScenario({ track: 'exception' }),
});
