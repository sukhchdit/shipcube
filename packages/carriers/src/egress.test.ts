import { afterEach, describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import type { RateRequest } from './canonical/types.js';
import type { CarrierContext } from './context.js';
import {
  type CarrierEgress,
  defineCarrierEgress,
  deriveCarrierEgressRules,
  type EgressAccount,
  egressBase,
  egressIssues,
  type EgressRule,
} from './egress.js';
import { CarrierContractError } from './errors.js';
import { guardAdapter } from './guard.js';
import { createFakeAdapter, FAKE_CARRIER, fakeContext } from './tests/fake-adapter.js';

/** A fictitious carrier on RFC 2606 names: sandbox and production share one origin, as DHL Express does. */
const FAKE_EGRESS: CarrierEgress = defineCarrierEgress(FAKE_CARRIER, {
  sandbox: [{ origin: 'https://api.carrier.example', pathPrefixes: ['/v1/test/', '/oauth/token'], tier: 'sandbox' }],
  production: [{ origin: 'https://api.carrier.example', pathPrefixes: ['/v1/', '/oauth/token'], tier: 'production' }],
});
const OTHER_EGRESS: CarrierEgress = defineCarrierEgress('OTHER', {
  sandbox: [{ origin: 'https://sandbox.other.example', pathPrefixes: ['/api/'], tier: 'sandbox' }],
  production: [{ origin: 'https://other.example', pathPrefixes: ['/api/'], tier: 'production' }],
});
const NO_EGRESS: CarrierEgress = defineCarrierEgress('MOCK', { sandbox: [], production: [] });
const TABLES = { [FAKE_CARRIER]: FAKE_EGRESS, OTHER: OTHER_EGRESS, MOCK: NO_EGRESS };

const account = (overrides: Partial<EgressAccount> = {}): EgressAccount => ({
  code: 'FAKE_PLATFORM_SANDBOX',
  carrierCode: FAKE_CARRIER,
  environment: 'sandbox',
  enabled: true,
  ...overrides,
});

const rateRequest: RateRequest = {
  origin: { countryCode: 'US', postalCode: '10001' },
  destination: { countryCode: 'IN', postalCode: '400001' },
  packages: [{ weightG: 2000, lengthMm: 300, widthMm: 200, heightMm: 100 }],
  contentType: 'PARCEL',
  direction: 'EXPORT',
  shipDate: '2026-11-20',
};

const savedEnv = { ...process.env };
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});

describe('[AT-US-121-04] the environment is read from the account, not a global flag', () => {
  /** An adapter that resolves its base URL per call, as every real adapter must (ADR-0010 am. 11 item 6). */
  function envAwareAdapter(): { urls: string[]; adapter: ReturnType<typeof guardAdapter> } {
    const urls: string[] = [];
    const adapter = guardAdapter({
      ...createFakeAdapter(),
      getRates: (_req, ctx: CarrierContext) => {
        urls.push(new URL('rates', egressBase(FAKE_EGRESS, ctx)).href);
        return Promise.resolve({ quotes: [] });
      },
    });
    return { urls, adapter };
  }

  it('[AT-US-121-04] the same adapter uses the sandbox base for a sandbox account and the production base for a production account', async () => {
    const { urls, adapter } = envAwareAdapter();
    await adapter.getRates(rateRequest, fakeContext({ environment: 'production' }));
    await adapter.getRates(rateRequest, fakeContext({ environment: 'sandbox' }));
    expect(urls).toEqual(['https://api.carrier.example/v1/rates', 'https://api.carrier.example/v1/test/rates']);
  });

  it('[AT-US-121-04] no global environment variable changes that selection', async () => {
    const { urls, adapter } = envAwareAdapter();
    await adapter.getRates(rateRequest, fakeContext({ environment: 'sandbox' }));
    Object.assign(process.env, {
      APP_ENV: 'production',
      NODE_ENV: 'production',
      CARRIER_ENVIRONMENT: 'production',
      [`CARRIER_${FAKE_CARRIER}_ENVIRONMENT`]: 'production',
      CARRIER_DHL_ENVIRONMENT: 'production',
    });
    await adapter.getRates(rateRequest, fakeContext({ environment: 'sandbox' }));
    process.env.APP_ENV = 'local';
    await adapter.getRates(rateRequest, fakeContext({ environment: 'production' }));
    expect(urls).toEqual([
      'https://api.carrier.example/v1/test/rates',
      'https://api.carrier.example/v1/test/rates',
      'https://api.carrier.example/v1/rates',
    ]);
  });

  it('[AT-US-121-04] a sandbox context never yields a URL outside its sandbox prefixes, a production context never one inside them', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z][a-z0-9/-]{0,30}$/u), (path) => {
        const sandbox = new URL(path, egressBase(FAKE_EGRESS, { environment: 'sandbox' })).pathname;
        const production = new URL(path, egressBase(FAKE_EGRESS, { environment: 'production' })).pathname;
        expect(sandbox.startsWith('/v1/test/')).toBe(true);
        expect(production.startsWith('/v1/test/')).toBe(false);
      }),
    );
  });

  it('an environment without a prefix rule has no base', () => {
    expect(() => egressBase(NO_EGRESS, { environment: 'sandbox' })).toThrow('EGRESS.sandbox has no prefix rule');
    const exactOnly = defineCarrierEgress('X', {
      sandbox: [{ origin: 'https://x.example', pathPrefixes: ['/token'], tier: 'sandbox' }],
      production: [],
    });
    expect(() => egressBase(exactOnly, { environment: 'sandbox' })).toThrow(CarrierContractError);
  });
});

describe('EGRESS tables are exact (ADR-0010 am. 11 item 6)', () => {
  it('the ADR rows for UPS, FedEx and DHL Express are valid tables', () => {
    const tables: CarrierEgress[] = [
      {
        sandbox: [{ origin: 'https://wwwcie.ups.com', pathPrefixes: ['/api/', '/security/v1/oauth/token'], tier: 'sandbox' }],
        production: [{ origin: 'https://onlinetools.ups.com', pathPrefixes: ['/api/', '/security/v1/oauth/token'], tier: 'production' }],
      },
      {
        sandbox: [
          { origin: 'https://apis-sandbox.fedex.com', pathPrefixes: ['/'], tier: 'sandbox' },
          { origin: 'https://documentapitest.prod.fedex.com', pathPrefixes: ['/sandbox/'], tier: 'sandbox' },
        ],
        production: [{ origin: 'https://apis.fedex.com', pathPrefixes: ['/'], tier: 'production' }],
      },
      {
        sandbox: [{ origin: 'https://express.api.dhl.com', pathPrefixes: ['/mydhlapi/test/'], tier: 'sandbox' }],
        production: [{ origin: 'https://express.api.dhl.com', pathPrefixes: ['/mydhlapi/'], tier: 'production' }],
      },
    ];
    for (const table of tables) expect(egressIssues(table)).toEqual([]);
  });

  const rule = (overrides: Partial<Record<keyof EgressRule, unknown>>): unknown => ({
    sandbox: [{ origin: 'https://api.carrier.example', pathPrefixes: ['/v1/'], tier: 'sandbox', ...overrides }],
    production: [],
  });

  it.each([
    ['http origin', { origin: 'http://api.carrier.example' }, 'must use https:'],
    ['credentials', { origin: 'https://user:pw@api.carrier.example' }, 'must not carry credentials'],
    ['a port', { origin: 'https://api.carrier.example:8443' }, 'must not carry a port'],
    ['a wildcard host', { origin: 'https://*.carrier.example' }, 'exact DNS name'],
    ['an IP literal', { origin: 'https://10.0.0.1' }, 'exact DNS name'],
    ['a single-label host', { origin: 'https://localhost' }, 'exact DNS name'],
    ['a path on the origin', { origin: 'https://api.carrier.example/v1' }, 'must be exactly https://api.carrier.example'],
    ['a trailing slash', { origin: 'https://api.carrier.example/' }, 'must be exactly'],
    ['upper case', { origin: 'https://API.carrier.example' }, 'must be exactly'],
    ['not a URL', { origin: 'carrier' }, 'is not a URL'],
    ['a non-string origin', { origin: 7 }, 'origin must be a string'],
    ['a relative prefix', { pathPrefixes: ['v1/'] }, 'must be an absolute path'],
    ['an encoded separator', { pathPrefixes: ['/v1%2f/'] }, 'must be an absolute path'],
    ['a dot segment', { pathPrefixes: ['/v1/../admin/'] }, 'must not contain dot segments'],
    ['an empty segment', { pathPrefixes: ['/v1//x/'] }, 'must not contain empty segments'],
    ['no prefix', { pathPrefixes: [] }, 'must be a non-empty array'],
    ['duplicate prefixes', { pathPrefixes: ['/v1/', '/v1/'] }, 'has duplicates'],
    ['a wildcard prefix', { pathPrefixes: ['/v1/*'] }, 'must be an absolute path'],
    ['a tier listed under the other environment', { tier: 'production' }, 'tier must be "sandbox"'],
    ['the gateway-test tier in a carrier table', { tier: 'gateway-test' }, 'tier must be "sandbox"'],
  ])('refuses %s', (_label, overrides, fragment) => {
    const issues = egressIssues(rule(overrides));
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join('\n')).toContain(fragment);
  });

  it('refuses malformed table shapes and names every defect at definition', () => {
    expect(egressIssues(null)).toEqual(['EGRESS must be an object with sandbox and production lists']);
    expect(egressIssues({ sandbox: [] })).toEqual(['EGRESS.production must be an array']);
    expect(egressIssues({ sandbox: ['x'], production: [] })).toEqual(['EGRESS.sandbox[0] must be an object']);
    expect(() => defineCarrierEgress('BAD', rule({ origin: 'http://x.example' }) as CarrierEgress)).toThrow('invalid EGRESS for BAD');
  });

  it('a defined table is frozen', () => {
    expect(Object.isFrozen(FAKE_EGRESS.sandbox[0]?.pathPrefixes)).toBe(true);
  });
});

describe('the outbound rule set is derived from enabled accounts only', () => {
  it('is the union of EGRESS[account.environment] over enabled accounts, de-duplicated', () => {
    const rules = deriveCarrierEgressRules({
      accounts: [
        account(),
        account({ code: 'FAKE_SECOND_SANDBOX' }),
        account({ code: 'OTHER_SANDBOX', carrierCode: 'OTHER', enabled: false }),
        account({ code: 'MOCK_DEFAULT', carrierCode: 'MOCK' }),
      ],
      egress: TABLES,
      appEnv: 'local',
    });
    expect(rules).toEqual(FAKE_EGRESS.sandbox);
    expect(Object.isFrozen(rules)).toBe(true);
    expect(deriveCarrierEgressRules({ accounts: [], egress: TABLES, appEnv: 'local' })).toEqual([]);
  });

  it('serves production rules only to a production account under APP_ENV=production', () => {
    const rules = deriveCarrierEgressRules({
      accounts: [
        account({ environment: 'production', code: 'FAKE_PLATFORM_LIVE' }),
        account({ code: 'OTHER_SANDBOX', carrierCode: 'OTHER' }),
      ],
      egress: TABLES,
      appEnv: 'production',
    });
    expect(rules.map(({ origin, tier }) => [origin, tier])).toEqual([
      ['https://api.carrier.example', 'production'],
      ['https://sandbox.other.example', 'sandbox'],
    ]);
  });

  it.each(['local', 'test', 'staging'])('refuses a production account under APP_ENV=%s (start-up refusal)', (appEnv) => {
    expect(() =>
      deriveCarrierEgressRules({ accounts: [account({ environment: 'production', code: 'FAKE_PLATFORM_LIVE' })], egress: TABLES, appEnv }),
    ).toThrow('account FAKE_PLATFORM_LIVE has environment production, which is refused unless APP_ENV=production');
  });

  it('refuses a production-tier rule reached through a sandbox account outside production', () => {
    const misfiled = {
      sandbox: [{ origin: 'https://x.example', pathPrefixes: ['/'], tier: 'production' }],
      production: [],
    } as unknown as CarrierEgress;
    expect(() =>
      deriveCarrierEgressRules({ accounts: [account({ carrierCode: 'MISFILED' })], egress: { MISFILED: misfiled }, appEnv: 'local' }),
    ).toThrow('MISFILED EGRESS.sandbox[0].tier must be "sandbox"');
  });

  it('fails closed for an enabled account whose carrier declares no EGRESS, including inherited property names', () => {
    expect(() => deriveCarrierEgressRules({ accounts: [account({ carrierCode: 'UNKNOWN' })], egress: TABLES, appEnv: 'local' })).toThrow(
      'carrier UNKNOWN declares no EGRESS',
    );
    expect(() =>
      deriveCarrierEgressRules({ accounts: [account({ carrierCode: 'constructor' })], egress: TABLES, appEnv: 'local' }),
    ).toThrow('carrier constructor declares no EGRESS');
  });

  it('property: no environment variable can add or change a rule (the derivation reads no configuration)', () => {
    const input = { accounts: [account(), account({ code: 'OTHER_SANDBOX', carrierCode: 'OTHER' })], egress: TABLES, appEnv: 'local' };
    const baseline = JSON.stringify(deriveCarrierEgressRules(input));
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.constantFrom(
            'CARRIER_EGRESS_EXTRA',
            'OUTBOUND_ALLOWLIST',
            'CARRIER_FAKE_CARRIER_ORIGIN',
            'APP_ENV',
            'NODE_ENV',
            'HTTPS_PROXY',
          ),
          fc.constantFrom('https://evil.example', 'production', '*', '/'),
        ),
        (env) => {
          Object.assign(process.env, env);
          expect(JSON.stringify(deriveCarrierEgressRules(input))).toBe(baseline);
        },
      ),
    );
  });
});
