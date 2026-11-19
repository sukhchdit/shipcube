/**
 * The egress contract of carrier adapters (ADR-0010 am. 11 item 6, PR6-SEC-01; refines ADR-0016 §13). Each real
 * adapter exports a static `EGRESS: CarrierEgress` from `adapters/<carrier>/egress.ts`: per environment, exact origins
 * with path prefixes and the tier they serve. Endpoints are part of the wire contract and change by ADR amendment, so:
 *  - `egressIssues` refuses anything that is not exact: `https:` only, no port, no credentials, no wildcard or suffix
 *    match, no path on the origin; prefixes are absolute, free of dot segments and encoded separators; an entry ending
 *    in `/` is a prefix, any other entry is an exact path (the matching rule itself is the OutboundHttpClient's,
 *    TASK-113); every rule's tier equals the environment it is listed under;
 *  - `deriveCarrierEgressRules` builds the carrier part of the outbound allow-list as the union over ENABLED accounts
 *    of `EGRESS[account.environment]`. It takes no configuration: no environment variable or key can add a rule. The
 *    OutboundHttpClient (TASK-113) appends the static Stripe rules. A production account outside `APP_ENV=production`
 *    refuses start-up (CLAUDE.md §5; `packages/config` already refuses `CARRIER_*_ENVIRONMENT=production`), and an
 *    account whose carrier declares no `EGRESS` fails closed;
 *  - `egressBase` gives an adapter its base URL from `ctx.environment` only (AT-US-121-04): the same adapter called
 *    with a sandbox and a production context reaches the sandbox and the production base, and no global flag changes it.
 * Carrier-supplied URLs (label links, tracking pages) are never rules and are never dereferenced.
 */
import type { CarrierEnvironment } from './canonical/codes.js';
import type { CarrierAccountRef, CarrierContext } from './context.js';
import { CarrierContractError } from './errors.js';

export type EgressTier = 'sandbox' | 'production' | 'gateway-test';

export interface EgressRule {
  /** Exact WHATWG origin: `https://host`, no port, no path, no credentials, no wildcard. */
  readonly origin: string;
  /** Absolute paths; an entry ending in `/` is a segment-boundary prefix, any other entry an exact path. */
  readonly pathPrefixes: readonly string[];
  readonly tier: EgressTier;
}

/** The static egress table a real adapter exports as `EGRESS`. The Mock exports empty lists (it makes no calls). */
export interface CarrierEgress {
  readonly sandbox: readonly EgressRule[];
  readonly production: readonly EgressRule[];
}

/** An enabled carrier account as the egress derivation sees it. */
export type EgressAccount = Pick<CarrierAccountRef, 'code' | 'carrierCode' | 'environment'> & { readonly enabled: boolean };

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
/** Percent-encoded `/`, `\` and `.`: refused in prefixes (ADR-0010 am. 11 item 6 matching rule). */
const ENCODED_SEPARATOR = /%(?:2f|5c|2e)/iu;
const PATH_CHARS = /^\/[A-Za-z0-9._~\-/]*$/u;

function originIssues(origin: unknown, path: string): string[] {
  if (typeof origin !== 'string') return [`${path}.origin must be a string`];
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return [`${path}.origin ${JSON.stringify(origin)} is not a URL`];
  }
  const issues: string[] = [];
  if (url.protocol !== 'https:') issues.push(`${path}.origin must use https:`);
  if (url.username !== '' || url.password !== '') issues.push(`${path}.origin must not carry credentials`);
  if (url.port !== '') issues.push(`${path}.origin must not carry a port`);
  const labels = url.hostname.split('.');
  const topLevel = labels.at(-1) ?? '';
  if (labels.length < 2 || !labels.every((label) => HOST_LABEL.test(label)) || !/[a-z]/u.test(topLevel)) {
    issues.push(`${path}.origin host must be an exact DNS name (no wildcard, no IP literal)`);
  }
  if (url.origin !== origin) issues.push(`${path}.origin must be exactly ${url.origin} (no path, trailing slash or upper case)`);
  return issues;
}

function prefixIssues(prefixes: unknown, path: string): string[] {
  if (!Array.isArray(prefixes) || prefixes.length === 0) return [`${path}.pathPrefixes must be a non-empty array`];
  const issues: string[] = [];
  prefixes.forEach((prefix, index) => {
    const at = `${path}.pathPrefixes[${String(index)}]`;
    if (typeof prefix !== 'string' || !PATH_CHARS.test(prefix)) issues.push(`${at} must be an absolute path of [A-Za-z0-9._~-/]`);
    else if (ENCODED_SEPARATOR.test(prefix)) issues.push(`${at} must not contain encoded separators`);
    else if (prefix.split('/').some((segment) => segment === '.' || segment === '..')) issues.push(`${at} must not contain dot segments`);
    else if (prefix.includes('//')) issues.push(`${at} must not contain empty segments`);
  });
  if (new Set(prefixes).size !== prefixes.length) issues.push(`${path}.pathPrefixes has duplicates`);
  return issues;
}

/** Every defect of a carrier `EGRESS` table; empty when every rule is exact and listed under its own tier. */
export function egressIssues(egress: unknown): string[] {
  if (typeof egress !== 'object' || egress === null) return ['EGRESS must be an object with sandbox and production lists'];
  const issues: string[] = [];
  for (const environment of ['sandbox', 'production'] as const) {
    const rules = (egress as Partial<Record<CarrierEnvironment, unknown>>)[environment];
    if (!Array.isArray(rules)) {
      issues.push(`EGRESS.${environment} must be an array`);
      continue;
    }
    rules.forEach((rule: unknown, index) => {
      const path = `EGRESS.${environment}[${String(index)}]`;
      if (typeof rule !== 'object' || rule === null) {
        issues.push(`${path} must be an object`);
        return;
      }
      const { origin, pathPrefixes, tier } = rule as Partial<Record<keyof EgressRule, unknown>>;
      issues.push(...originIssues(origin, path), ...prefixIssues(pathPrefixes, path));
      if (tier !== environment) issues.push(`${path}.tier must be "${environment}" (the environment it is listed under)`);
    });
  }
  return issues;
}

/** Throws `CarrierContractError` naming every defect of `egress`; returns it unchanged otherwise. */
export function defineCarrierEgress(carrierCode: string, egress: CarrierEgress): CarrierEgress {
  const issues = egressIssues(egress);
  if (issues.length > 0) throw new CarrierContractError(`invalid EGRESS for ${carrierCode}`, issues);
  const freezeRule = (rule: EgressRule): EgressRule => Object.freeze({ ...rule, pathPrefixes: Object.freeze([...rule.pathPrefixes]) });
  return Object.freeze({
    sandbox: Object.freeze(egress.sandbox.map(freezeRule)),
    production: Object.freeze(egress.production.map(freezeRule)),
  });
}

export interface DeriveEgressInput {
  /** Every configured carrier account; disabled ones contribute nothing. */
  readonly accounts: readonly EgressAccount[];
  /** Static `EGRESS` tables by carrier code (the adapters' exports). */
  readonly egress: Readonly<Record<string, CarrierEgress>>;
  /** `APP_ENV` of the process. */
  readonly appEnv: string;
}

const ruleKey = (rule: EgressRule): string => JSON.stringify([rule.origin, rule.tier, [...rule.pathPrefixes].sort()]);

/**
 * The carrier part of the outbound allow-list: the union over enabled accounts of `EGRESS[account.environment]`,
 * de-duplicated, frozen. Throws `CarrierContractError` (start-up refusal) for a production account outside
 * `APP_ENV=production`, for an account whose carrier has no `EGRESS`, and for a malformed table.
 */
export function deriveCarrierEgressRules({ accounts, egress, appEnv }: DeriveEgressInput): readonly EgressRule[] {
  const issues: string[] = [];
  const rules = new Map<string, EgressRule>();
  for (const account of accounts.filter(({ enabled }) => enabled)) {
    if (account.environment === 'production' && appEnv !== 'production') {
      issues.push(`account ${account.code} has environment production, which is refused unless APP_ENV=production`);
      continue;
    }
    const table = Object.hasOwn(egress, account.carrierCode) ? egress[account.carrierCode] : undefined;
    if (table === undefined) {
      issues.push(`account ${account.code}: carrier ${account.carrierCode} declares no EGRESS`);
      continue;
    }
    const tableIssues = egressIssues(table);
    if (tableIssues.length > 0) {
      issues.push(...tableIssues.map((issue) => `${account.carrierCode} ${issue}`));
      continue;
    }
    for (const rule of table[account.environment]) rules.set(ruleKey(rule), rule);
  }
  const derived = [...rules.values()];
  if (appEnv !== 'production' && derived.some(({ tier }) => tier === 'production')) {
    issues.push('a production-tier egress rule is refused unless APP_ENV=production');
  }
  if (issues.length > 0) throw new CarrierContractError('carrier egress refused', [...new Set(issues)]);
  return Object.freeze(derived.map((rule) => Object.freeze({ ...rule, pathPrefixes: Object.freeze([...rule.pathPrefixes]) })));
}

/**
 * The API base URL of an adapter for one call: the first prefix rule (an entry ending in `/`) of
 * `EGRESS[ctx.environment]`, as `origin + prefix`. Reads the context only, never a global flag. Throws
 * `CarrierContractError` when that environment has no prefix rule.
 */
export function egressBase(egress: CarrierEgress, ctx: Pick<CarrierContext, 'environment'>): URL {
  for (const rule of egress[ctx.environment]) {
    const prefix = rule.pathPrefixes.find((entry) => entry.endsWith('/'));
    if (prefix !== undefined && rule.tier === ctx.environment) return new URL(`${rule.origin}${prefix}`);
  }
  throw new CarrierContractError('no egress base', [`EGRESS.${ctx.environment} has no prefix rule`]);
}
