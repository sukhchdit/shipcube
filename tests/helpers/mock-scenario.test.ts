import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import {
  MOCK_FAIL_OPERATIONS,
  MOCK_SCENARIO_HEADER,
  MOCK_SCENARIOS,
  MOCK_TRACK_OUTCOMES,
  type MockScenario,
  MockScenarioError,
  mockScenario,
  parseMockScenario,
  rawScenario,
  renderMockScenario,
} from './mock-scenario.js';

describe('[REQ-CARR-005] Mock scenario builder (DR-B29)', () => {
  it('renders the documented examples canonically', () => {
    expect(renderMockScenario({ latencyMs: 6_000 })).toBe('latency=6000');
    expect(renderMockScenario({ latencyMs: 6_000, fail: ['booking'] })).toBe('latency=6000;fail=booking');
    expect(renderMockScenario({ track: 'exception', ratesEmpty: true, error: 'CARRIER_TIMEOUT', fail: ['void', 'booking'] })).toBe(
      'fail=booking;fail=void;error=CARRIER_TIMEOUT;rates=empty;track=exception',
    );
    expect(renderMockScenario({})).toBe('');
  });

  it('exposes the header, the MOCK: customer-reference form and named scenarios', () => {
    const built = mockScenario({ fail: ['booking'] });
    expect(built.headers).toEqual({ [MOCK_SCENARIO_HEADER]: 'fail=booking' });
    expect(built.customerReference).toBe('MOCK:fail=booking');
    expect(MOCK_SCENARIOS.slowCarrier.directive).toBe('latency=6000');
    expect(rawScenario('latency=40000;foo=bar')).toEqual({ 'X-Mock-Scenario': 'latency=40000;foo=bar' });
  });

  it('the builder refuses what the API would refuse (400 MOCK_SCENARIO_INVALID)', () => {
    expect(() => mockScenario({ latencyMs: 30_001 })).toThrow(MockScenarioError);
    expect(() => mockScenario({ latencyMs: -1 })).toThrow(MockScenarioError);
    expect(() => mockScenario({ latencyMs: 1.5 })).toThrow(MockScenarioError);
    expect(() => mockScenario({ error: 'lower_case' })).toThrow(MockScenarioError);
    expect(() => mockScenario({ track: 'sideways' as never })).toThrow(MockScenarioError);
    expect(() => mockScenario({ fail: ['teleport' as never] })).toThrow(MockScenarioError);
    expect(new MockScenarioError('x').code).toBe('MOCK_SCENARIO_INVALID');
  });
});

describe('[REQ-CARR-005] parseMockScenario', () => {
  it('parses header and MOCK: reference forms, order-insensitively', () => {
    expect(parseMockScenario('fail=void;latency=0')).toEqual({ latencyMs: 0, fail: ['void'] });
    expect(parseMockScenario('MOCK:track=delayed;rates=empty')).toEqual({ track: 'delayed', ratesEmpty: true });
    expect(parseMockScenario('')).toEqual({});
  });

  it('rejects unknown keys, bad values and repeated single-valued directives', () => {
    for (const bad of [
      'foo=bar',
      'latency=40000',
      'latency=-5',
      'latency=1e3',
      'latency=1;latency=2',
      'fail=teleport',
      'rates=full',
      'track=sideways',
      'error=lower',
      'novalue',
      '=x',
    ]) {
      expect(() => parseMockScenario(bad)).toThrow(MockScenarioError);
    }
  });

  it('property: parse(render(s)) is s for every valid scenario, and render is canonical', () => {
    const scenario = fc.record(
      {
        latencyMs: fc.integer({ min: 0, max: 30_000 }),
        fail: fc.uniqueArray(fc.constantFrom(...MOCK_FAIL_OPERATIONS)),
        error: fc.stringMatching(/^[A-Z][A-Z0-9_]{1,20}$/),
        ratesEmpty: fc.constant(true as const),
        track: fc.constantFrom(...MOCK_TRACK_OUTCOMES),
      },
      { requiredKeys: [] },
    );
    fc.assert(
      fc.property(scenario, (s: MockScenario) => {
        const text = renderMockScenario(s);
        const parsed = parseMockScenario(text);
        expect(renderMockScenario(parsed)).toBe(text);
        expect(parsed.latencyMs).toBe(s.latencyMs);
        expect(parsed.track).toBe(s.track);
        expect(parsed.error).toBe(s.error);
        expect([...(parsed.fail ?? [])].sort()).toEqual([...(s.fail ?? [])].sort());
      }),
      { numRuns: 100, seed: 20261113 },
    );
  });
});
