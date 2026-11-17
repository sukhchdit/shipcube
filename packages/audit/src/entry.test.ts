import { describe, expect, it } from '@jest/globals';
import { ANONYMOUS_ACTOR_ID, SYSTEM_ACTOR_ID } from '@platform/shared';
import fc from 'fast-check';

import {
  type AuditEntryInput,
  type AuditValue,
  isAuditEntityId,
  isAuditRouteTemplate,
  isAuditUaParsed,
  MAX_JSON_DEPTH,
  MAX_PII_VALUES,
  MAX_USER_AGENT_LENGTH,
  pii,
  PiiValue,
  prepareEntry,
  type PrepareOptions,
  systemShardStreamId,
  wellFormed,
} from './entry.js';
import { auditErrorCause, AuditWriteError } from './errors.js';

const ORG = '019a7c3e-0000-7000-8000-0000000000aa';
const USER = '019a7c3e-0000-7000-8000-0000000000bb';
const SESSION = '019a7c3e-0000-7000-8000-0000000000dd';
const ID = '019a7c3e-0000-7000-8000-000000000001';
const TOKENS = ['019a7c3e-0000-7000-8000-0000000000c1', '019a7c3e-0000-7000-8000-0000000000c2', '019a7c3e-0000-7000-8000-0000000000c3'];
const OPTIONS: PrepareOptions = { id: ID, systemShard: 3 };

const LOGIN: AuditEntryInput = {
  action: 'LOGIN',
  outcome: 'SUCCESS',
  entityName: 'session',
  entityId: SESSION,
  orgId: ORG,
  actor: { type: 'USER', userId: USER, roles: ['Owner'], sessionId: SESSION },
  origin: {
    sourceApp: 'web',
    correlationId: 'corr-0001-login',
    ip: '203.0.113.77',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0) Firefox/146.0',
    uaParsed: 'Firefox 146 / Windows',
    httpMethod: 'POST',
    route: '/auth/login',
  },
};

function refusal(input: unknown, options: PrepareOptions = OPTIONS): AuditWriteError {
  try {
    prepareEntry(input as AuditEntryInput, options);
  } catch (error) {
    if (error instanceof AuditWriteError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

/** The AuditWriteError kind a call throws, 'other' for any other throw, undefined when it returns. */
function kindOf(call: () => unknown): string | undefined {
  try {
    call();
  } catch (error) {
    return error instanceof AuditWriteError ? error.kind : 'other';
  }
  return undefined;
}

const withOrigin = (origin: Partial<AuditEntryInput['origin']>): AuditEntryInput => ({ ...LOGIN, origin: { ...LOGIN.origin, ...origin } });

describe('[US-087] entry contract: complete fields (REQ-AUDIT-003/011)', () => {
  it('[AT-US-087-01] a user LOGIN carries every field; IP and raw user agent become vault tokens, the network stays coarse', () => {
    const prepared = prepareEntry(LOGIN, { ...OPTIONS, ipIndex: { keyId: 'audit-index-v1', hash: () => new Uint8Array(32).fill(7) } });
    expect(prepared.piiValues.map((value) => [value.entityName, value.field, value.classification, value.value, value.subject])).toEqual([
      ['audit_entry', 'ip', 'PERSONAL', '203.0.113.77', { kind: 'USER', refId: USER }],
      ['audit_entry', 'user_agent', 'PERSONAL', LOGIN.origin.userAgent, { kind: 'USER', refId: USER }],
    ]);
    const row = prepared.complete(TOKENS.slice(0, 2));
    expect(row).toEqual({
      id: ID,
      streamId: ORG,
      orgId: ORG,
      targetOrgId: null,
      onBehalfOfOrgId: null,
      actorType: 'USER',
      userId: USER,
      apiKeyId: null,
      jobName: null,
      actorRoles: ['Owner'],
      sessionId: SESSION,
      ipToken: TOKENS[0],
      ipHash: '07'.repeat(32),
      ipHashKeyId: 'audit-index-v1',
      ipCoarse: '203.0.113.0/24',
      userAgentToken: TOKENS[1],
      uaParsed: 'Firefox 146 / Windows',
      sourceApp: 'web',
      correlationId: 'corr-0001-login',
      action: 'LOGIN',
      entityName: 'session',
      entityId: SESSION,
      outcome: 'SUCCESS',
      reasonToken: null,
      reauthProofId: null,
      signatureMeaning: null,
      httpMethod: 'POST',
      route: '/auth/login',
      oldValue: null,
      newValue: null,
      details: null,
      piiTokenCount: 2,
      hashVersion: 1,
    });
    expect(JSON.stringify(row)).not.toContain('203.0.113.77');
    expect(JSON.stringify(row)).not.toContain('Mozilla');
  });

  it('[AT-US-087-02] a STATE_TRANSITION records the old and the new state, and needs both', () => {
    const transition: AuditEntryInput = {
      ...LOGIN,
      action: 'STATE_TRANSITION',
      entityName: 'shipment',
      oldValue: { state: 'DRAFT' },
      newValue: { state: 'QUOTED' },
      origin: { sourceApp: 'api', correlationId: 'corr-0002-state' },
    };
    const row = prepareEntry(transition, OPTIONS).complete([]);
    expect([row.oldValue, row.newValue]).toEqual([{ state: 'DRAFT' }, { state: 'QUOTED' }]);
    expect(refusal({ ...transition, oldValue: null }).field).toBe('oldValue');
    expect(refusal({ ...transition, newValue: undefined }).field).toBe('newValue');
  });

  it('[AT-US-087-03] a worker job is SYSTEM_JOB with its job name and originating correlation id; user_id is the SYSTEM actor', () => {
    const row = prepareEntry(
      {
        action: 'UPDATE',
        outcome: 'SUCCESS',
        entityName: 'shipment',
        entityId: 'shp-1',
        orgId: ORG,
        actor: { type: 'SYSTEM_JOB', jobName: 'tracking-poll' },
        origin: { sourceApp: 'worker', correlationId: 'origin-req-0042' },
      },
      OPTIONS,
    ).complete([]);
    expect(row).toMatchObject({
      actorType: 'SYSTEM_JOB',
      jobName: 'tracking-poll',
      userId: SYSTEM_ACTOR_ID,
      correlationId: 'origin-req-0042',
    });
    expect(row.actorRoles).toEqual([]);
  });

  it('[AT-US-087-03] a guest quote is ANONYMOUS with IP and user agent and no user id; no organisation writes a SYSTEM shard', () => {
    const prepared = prepareEntry(
      {
        action: 'CREATE',
        outcome: 'SUCCESS',
        entityName: 'quote',
        orgId: '',
        actor: { type: 'ANONYMOUS' },
        origin: { sourceApp: 'web', correlationId: 'guest-quote-0001', ip: '2001:db8:abcd:12::1', userAgent: 'curl/8' },
      },
      OPTIONS,
    );
    expect(prepared.piiValues.map((value) => [value.field, value.subject])).toEqual([
      ['ip', null],
      ['user_agent', null],
    ]);
    const row = prepared.complete(TOKENS.slice(0, 2));
    expect(row).toMatchObject({
      actorType: 'ANONYMOUS',
      userId: null,
      orgId: null,
      streamId: systemShardStreamId(3),
      ipToken: TOKENS[0],
      userAgentToken: TOKENS[1],
      ipCoarse: '2001:db8:abcd::/48',
      ipHash: null,
      ipHashKeyId: null,
    });
  });

  it('[AT-US-087-06] a failed login for an unknown account is ANONYMOUS, DENIED and has no user id; LOGIN_FAILED is DENIED-only', () => {
    const failed: AuditEntryInput = {
      action: 'LOGIN_FAILED',
      outcome: 'DENIED',
      entityName: 'session',
      orgId: null,
      actor: { type: 'ANONYMOUS' },
      origin: { sourceApp: 'web', correlationId: 'corr-0006-failed' },
    };
    expect(prepareEntry(failed, OPTIONS).complete([])).toMatchObject({ actorType: 'ANONYMOUS', outcome: 'DENIED', userId: null });
    expect(refusal({ ...failed, outcome: 'SUCCESS' }).field).toBe('outcome');
    expect(refusal({ ...failed, action: 'PERMISSION_DENIED', outcome: 'FAILED' }).field).toBe('outcome');
  });

  it('[AT-US-087-05] an unknown action is refused before any statement', () => {
    expect(refusal({ ...LOGIN, action: 'FOO' })).toMatchObject({ kind: 'INVALID_ENTRY', field: 'action', status: 500 });
  });

  it('API_KEY actors (M3 seam) keep their key id and optional user; operator cross-tenant targets are kept', () => {
    const row = prepareEntry(
      {
        ...LOGIN,
        action: 'API_KEY_USE',
        targetOrgId: USER,
        actor: { type: 'API_KEY', apiKeyId: SESSION, roles: ['Shipper'] },
        origin: { sourceApp: 'api', correlationId: 'corr-0007-apikey' },
      },
      OPTIONS,
    ).complete([]);
    expect(row).toMatchObject({ actorType: 'API_KEY', apiKeyId: SESSION, userId: null, sessionId: null, targetOrgId: USER });
    const withUser = prepareEntry(
      {
        ...LOGIN,
        actor: { type: 'API_KEY', apiKeyId: SESSION, userId: USER.toUpperCase() },
        origin: { sourceApp: 'api', correlationId: 'corr-0008-apikey' },
      },
      OPTIONS,
    ).complete([]);
    expect(withUser.userId).toBe(USER);
  });

  it('a typed reason is tokenised, and an explicit subject owns the entry personal fields', () => {
    const contact = { kind: 'CONTACT', refId: SESSION } as const;
    const prepared = prepareEntry({ ...LOGIN, reason: 'customer asked', subject: contact }, OPTIONS);
    expect(prepared.piiValues.map((value) => [value.field, value.subject])).toEqual([
      ['ip', contact],
      ['user_agent', contact],
      ['reason', contact],
    ]);
    expect(prepared.complete(TOKENS).reasonToken).toBe(TOKENS[2]);
  });
});

describe('[US-087] personal values inside JSON values are tokenised in one ordered batch', () => {
  const name = pii({ entityName: 'shipment_party', field: 'name', classification: 'PERSONAL', value: 'Asha Rao', subject: null });
  const phone = pii({
    entityName: 'shipment_party',
    field: 'phone',
    classification: 'SENSITIVE_PERSONAL',
    value: '+15550100',
    subject: null,
  });
  const entry: AuditEntryInput = {
    ...LOGIN,
    action: 'UPDATE',
    entityName: 'shipment_party',
    origin: { sourceApp: 'api', correlationId: 'corr-0009-pii' },
    oldValue: { phone, name: 'unchanged' },
    newValue: { receiver: { name, phone }, tags: [1, true, null, 'x'] },
    details: { list: [name] },
  };

  it('collects in canonical order (old, new, details; keys sorted) and substitutes {"$pii": token} in the same order', () => {
    const prepared = prepareEntry(entry, OPTIONS);
    expect(prepared.piiValues).toEqual([phone, name, phone, name]);
    const tokens = ['01', '02', '03', '04'].map((n) => `019a7c3e-0000-7000-8000-0000000000${n}`);
    const row = prepared.complete(tokens);
    expect(row.oldValue).toEqual({ name: 'unchanged', phone: { $pii: tokens[0] } });
    expect(row.newValue).toEqual({ receiver: { name: { $pii: tokens[1] }, phone: { $pii: tokens[2] } }, tags: [1, true, null, 'x'] });
    expect(row.details).toEqual({ list: [{ $pii: tokens[3] }] });
    expect(row.piiTokenCount).toBe(4);
    expect(JSON.stringify(row)).not.toContain('Asha');
  });

  it('a token list of the wrong length or shape fails as TOKENISER_FAILED', () => {
    const prepared = prepareEntry(entry, OPTIONS);
    expect(kindOf(() => prepared.complete(TOKENS))).toBe('TOKENISER_FAILED');
    expect(kindOf(() => prepared.complete(['x', 'y', 'z', 'w']))).toBe('TOKENISER_FAILED');
  });

  it('a "__proto__" key from JSON.parse stays a plain key of the stored value', () => {
    const value = JSON.parse('{"__proto__":{"polluted":true},"a":1}') as AuditValue;
    const row = prepareEntry({ ...entry, oldValue: null, newValue: value, details: null }, OPTIONS).complete([]);
    expect(Object.keys(row.newValue as object)).toEqual(['__proto__', 'a']);
    expect(JSON.stringify(row.newValue)).toBe('{"__proto__":{"polluted":true},"a":1}');
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('a PiiValue is frozen and copies its subject', () => {
    const subject = { kind: 'USER' as const, refId: USER };
    const value = new PiiValue({ entityName: 'user', field: 'email', classification: 'PERSONAL', value: 'a@b.c', subject });
    expect(Object.isFrozen(value)).toBe(true);
    expect(value.subject).not.toBe(subject);
    expect(value.subject).toEqual(subject);
  });
});

describe('[US-087] the writer refuses an invalid entry before any statement (INVALID_ENTRY, field path only)', () => {
  const deep = (depth: number): AuditValue => (depth === 0 ? 'leaf' : { next: deep(depth - 1) });
  const cases: Array<[string, unknown, string]> = [
    ['entry not an object', null, 'entry'],
    ['outcome', { ...LOGIN, outcome: 'OK' }, 'outcome'],
    ['entity name', { ...LOGIN, entityName: 'Session' }, 'entityName'],
    ['entity id empty', { ...LOGIN, entityId: '' }, 'entityId'],
    ['entity id with NUL', { ...LOGIN, entityId: `a${String.fromCharCode(0)}b` }, 'entityId'],
    ['org id', { ...LOGIN, orgId: 'not-a-uuid' }, 'orgId'],
    ['target org id', { ...LOGIN, targetOrgId: 42 }, 'targetOrgId'],
    ['actor missing', { ...LOGIN, actor: null }, 'actor'],
    ['actor type', { ...LOGIN, actor: { type: 'ROBOT' } }, 'actor.type'],
    ['reserved SYSTEM actor as user', { ...LOGIN, actor: { type: 'USER', userId: SYSTEM_ACTOR_ID } }, 'actor.userId'],
    ['reserved ANONYMOUS actor as user', { ...LOGIN, actor: { type: 'USER', userId: ANONYMOUS_ACTOR_ID } }, 'actor.userId'],
    ['session id', { ...LOGIN, actor: { type: 'USER', userId: USER, sessionId: 'x' } }, 'actor.sessionId'],
    ['roles not an array', { ...LOGIN, actor: { type: 'USER', userId: USER, roles: 'Owner' } }, 'actor.roles'],
    ['role key', { ...LOGIN, actor: { type: 'USER', userId: USER, roles: ['has space'] } }, 'actor.roles[0]'],
    ['too many roles', { ...LOGIN, actor: { type: 'USER', userId: USER, roles: new Array(33).fill('R') } }, 'actor.roles'],
    ['api key id', { ...LOGIN, actor: { type: 'API_KEY', apiKeyId: 'k' } }, 'actor.apiKeyId'],
    ['job name', { ...LOGIN, actor: { type: 'SYSTEM_JOB', jobName: 'Bad Name' } }, 'actor.jobName'],
    ['origin missing', { ...LOGIN, origin: null }, 'origin'],
    ['source app', withOrigin({ sourceApp: 'mobile' as 'web' }), 'origin.sourceApp'],
    ['correlation id', withOrigin({ correlationId: 'short' }), 'origin.correlationId'],
    ['ip', withOrigin({ ip: '999.1.1.1' }), 'origin.ip'],
    ['ua parsed too long', withOrigin({ uaParsed: 'x'.repeat(121) }), 'origin.uaParsed'],
    ['http method', withOrigin({ httpMethod: 'TRACE' }), 'origin.httpMethod'],
    ['route', withOrigin({ route: 'https://x/y' }), 'origin.route'],
    ['reason too long', { ...LOGIN, reason: 'r'.repeat(501) }, 'reason'],
    ['subject kind', { ...LOGIN, subject: { kind: 'ROBOT', refId: USER } }, 'subject.kind'],
    ['subject not an object', { ...LOGIN, subject: 'user' }, 'subject.kind'],
    ['user agent not a string', withOrigin({ userAgent: 42 as unknown as string }), 'origin.userAgent'],
    ['subject ref', { ...LOGIN, subject: { kind: 'USER', refId: 'x' } }, 'subject.refId'],
    ['non-finite number', { ...LOGIN, newValue: { n: Number.POSITIVE_INFINITY } }, 'newValue.n'],
    ['NUL in a string', { ...LOGIN, newValue: [String.fromCharCode(0)] }, 'newValue[0]'],
    ['forged token marker', { ...LOGIN, newValue: { $pii: '019a7c3e-0000-7000-8000-0000000000c1' } }, 'newValue'],
    ['NUL in a key', { ...LOGIN, oldValue: { [`k${String.fromCharCode(0)}`]: 1 } }, 'oldValue'],
    ['non-plain object', { ...LOGIN, newValue: new Date(0) }, 'newValue'],
    ['undefined leaf', { ...LOGIN, newValue: { u: undefined } }, 'newValue.u'],
    // R1-n3: below the top level an object key is business data and appears as `{key}`.
    ['too deep', { ...LOGIN, newValue: deep(MAX_JSON_DEPTH + 1) }, `newValue.next${'.{key}'.repeat(MAX_JSON_DEPTH)}`],
    // The node budget spans the whole entry; an absent (null) top-level value is no node, so the array is node 1.
    ['too many nodes', { ...LOGIN, newValue: new Array(10_001).fill(0) }, 'newValue[9999]'],
    [
      'pii entity',
      { ...LOGIN, newValue: { x: pii({ entityName: 'Bad', field: 'f', classification: 'PERSONAL', value: 'v', subject: null }) } },
      'newValue.x.entityName',
    ],
    [
      'pii field',
      { ...LOGIN, newValue: { x: pii({ entityName: 'user', field: '', classification: 'PERSONAL', value: 'v', subject: null }) } },
      'newValue.x.field',
    ],
    [
      'pii classification',
      {
        ...LOGIN,
        newValue: { x: pii({ entityName: 'user', field: 'f', classification: 'SECRET' as 'PERSONAL', value: 'v', subject: null }) },
      },
      'newValue.x.classification',
    ],
    [
      'pii value empty',
      { ...LOGIN, newValue: { x: pii({ entityName: 'user', field: 'f', classification: 'PERSONAL', value: '', subject: null }) } },
      'newValue.x.value',
    ],
    [
      'pii subject',
      {
        ...LOGIN,
        newValue: {
          x: pii({ entityName: 'user', field: 'f', classification: 'PERSONAL', value: 'v', subject: { kind: 'USER', refId: 'nope' } }),
        },
      },
      'newValue.x.subject.refId',
    ],
    [
      'too many personal values',
      {
        ...LOGIN,
        newValue: new Array(MAX_PII_VALUES).fill(
          pii({ entityName: 'user', field: 'f', classification: 'PERSONAL', value: 'v', subject: null }),
        ),
      },
      'pii',
    ],
  ];

  it.each(cases)('%s', (_label, input, field) => {
    expect(refusal(input)).toMatchObject({ kind: 'INVALID_ENTRY', reason: 'AUDIT_WRITE_FAILED', field });
  });

  it('refuses a malformed entry id, a bad IP index (IP_INDEX_FAILED, R1-n4) and an out-of-range shard', () => {
    expect(refusal(LOGIN, { ...OPTIONS, id: 'x' }).field).toBe('id');
    expect(refusal(LOGIN, { ...OPTIONS, ipIndex: { keyId: 'Bad', hash: () => new Uint8Array(32) } }).kind).toBe('IP_INDEX_FAILED');
    expect(refusal(LOGIN, { ...OPTIONS, ipIndex: { keyId: 'audit-index-v1', hash: () => new Uint8Array(31) } }).kind).toBe(
      'IP_INDEX_FAILED',
    );
    expect(() => systemShardStreamId(16)).toThrow(RangeError);
    expect(() => systemShardStreamId(1.5)).toThrow(RangeError);
    expect(systemShardStreamId(0)).toBe('00000000-0000-0000-0000-000000000000');
    expect(systemShardStreamId(15)).toBe('00000000-0000-0000-0000-00000000000f');
  });

  it('normalises: uppercase UUIDs lower-cased, empty user agent dropped, a long user agent truncated by code point', () => {
    const emoji = '\u{1F600}';
    const long = `${'a'.repeat(MAX_USER_AGENT_LENGTH - 1)}${emoji}${emoji}`;
    const prepared = prepareEntry({ ...LOGIN, orgId: ORG.toUpperCase(), origin: { ...LOGIN.origin, userAgent: long, ip: null } }, OPTIONS);
    expect(prepared.piiValues.map((value) => value.value)).toEqual([`${'a'.repeat(MAX_USER_AGENT_LENGTH - 1)}${emoji}`]);
    const row = prepared.complete(TOKENS.slice(0, 1));
    expect(row).toMatchObject({ orgId: ORG, streamId: ORG, ipToken: null, ipCoarse: null, userAgentToken: TOKENS[0] });
    expect(
      prepareEntry({ ...LOGIN, origin: { sourceApp: 'web', correlationId: 'corr-0011-noip', userAgent: '' } }, OPTIONS).piiValues,
    ).toEqual([]);
  });

  it('property: any JSON value without markers round-trips unchanged and yields no personal values', () => {
    fc.assert(
      fc.property(fc.jsonValue({ maxDepth: 4 }), (value) => {
        const text = JSON.stringify(value);
        fc.pre(!text.includes('"$pii"') && !/\\u0000|\\ud[89a-f]/i.test(text));
        const json = JSON.parse(text) as AuditValue;
        const prepared = prepareEntry({ ...LOGIN, origin: { sourceApp: 'api', correlationId: 'corr-0010-prop' }, details: json }, OPTIONS);
        expect(prepared.piiValues).toHaveLength(0);
        expect(prepared.complete([]).details).toEqual(json);
      }),
      { seed: 88, numRuns: 150 },
    );
  });
});

describe('[PR #42 R1-m3 / PR42-SEC-12] lone surrogates are normalised to U+FFFD (what PostgreSQL stores), NUL stays refused', () => {
  const high = String.fromCharCode(0xd800);
  const low = String.fromCharCode(0xdc00);
  const fffd = String.fromCharCode(0xfffd);
  const native = (String.prototype as unknown as { readonly toWellFormed?: (this: string) => string }).toWellFormed;

  it('wellFormed equals String.prototype.toWellFormed on random code-unit strings', () => {
    expect(typeof native).toBe('function');
    const toWellFormed = native as (this: string) => string;
    const unit = fc.oneof(fc.integer({ min: 0xd800, max: 0xdfff }), fc.integer({ min: 0, max: 0xffff }));
    fc.assert(
      fc.property(fc.array(unit, { maxLength: 24 }), (codes) => {
        const text = String.fromCharCode(...codes);
        expect(wellFormed(text)).toBe(toWellFormed.call(text));
      }),
      { seed: 125, numRuns: 400 },
    );
  });

  it('strings, keys, the reason and personal values are normalised instead of refused (no client-controllable 500)', () => {
    const prepared = prepareEntry(
      {
        ...LOGIN,
        reason: `why${high}`,
        newValue: { s: `a${high}b`, [`k${low}`]: [`${low}${high}`], pair: `ok${high}${low}` },
        details: { p: pii({ entityName: 'user', field: 'name', classification: 'PERSONAL', value: `n${low}`, subject: null }) },
      },
      OPTIONS,
    );
    expect(prepared.piiValues.map((value) => value.value)).toEqual([`n${fffd}`, '203.0.113.77', LOGIN.origin.userAgent, `why${fffd}`]);
    const row = prepared.complete([...TOKENS, TOKENS[0] as string]);
    expect(row.newValue).toEqual({ s: `a${fffd}b`, [`k${fffd}`]: [`${fffd}${fffd}`], pair: `ok${high}${low}` });
    expect(JSON.stringify(row.newValue)).not.toMatch(/\\ud[89a-f]/iu);
  });

  it('two keys that normalise to the same text, and NUL anywhere, are refused', () => {
    expect(refusal({ ...LOGIN, newValue: { [`a${high}`]: 1, [`a${low}`]: 2 } })).toMatchObject({
      kind: 'INVALID_ENTRY',
      field: 'newValue',
    });
    expect(refusal({ ...LOGIN, reason: `r${String.fromCharCode(0)}` }).field).toBe('reason');
    expect(refusal({ ...LOGIN, details: { s: String.fromCharCode(0) } }).field).toBe('details.s');
  });
});

describe('[PR #42 R1-m2 / PR42-SEC-03] validate once, assemble from the snapshot', () => {
  const marker = { $pii: TOKENS[2] as string };

  it('mutations after prepareEntry (outcome, a forged marker, a Date, a NUL, origin fields) never reach the row', () => {
    const newValue: Record<string, unknown> = { city: 'Pune', nested: { street: 'MG Road' } };
    const origin: Record<string, unknown> = { ...LOGIN.origin, ip: null, userAgent: null };
    const input: Record<string, unknown> = { ...LOGIN, action: 'LOGIN_FAILED', outcome: 'DENIED', origin, newValue };
    const prepared = prepareEntry(input as unknown as AuditEntryInput, OPTIONS);
    const expected = prepareEntry(JSON.parse(JSON.stringify(input)) as AuditEntryInput, OPTIONS).complete([]);
    input['outcome'] = 'SUCCESS';
    input['action'] = 'DELETE';
    newValue['owner'] = marker;
    newValue['nested'] = new Date(0);
    newValue['city'] = String.fromCharCode(0);
    origin['correlationId'] = 'bad';
    origin['sourceApp'] = 'mobile';
    origin['route'] = '/users?email=a@b.c';
    expect(prepared.complete([])).toEqual(expected);
    expect(prepared.complete([])).toMatchObject({ outcome: 'DENIED', action: 'LOGIN_FAILED', correlationId: 'corr-0001-login' });
  });

  it('an accessor that answers a string first and a forged marker second is read once', () => {
    let reads = 0;
    const details = Object.defineProperty({}, 'owner', {
      enumerable: true,
      get: () => {
        reads += 1;
        return reads === 1 ? 'plain' : marker;
      },
    });
    const row = prepareEntry({ ...LOGIN, origin: { sourceApp: 'web', correlationId: 'corr-0012-getter' }, details }, OPTIONS).complete([]);
    expect(row.details).toEqual({ owner: 'plain' });
    expect(reads).toBe(1);
  });

  it('a PiiValue look-alike with accessors is copied once; the tokeniser sees the frozen copy', () => {
    let reads = 0;
    const forged = Object.create(PiiValue.prototype, {
      entityName: { value: 'user', enumerable: true },
      field: { value: 'email', enumerable: true },
      classification: { value: 'PERSONAL', enumerable: true },
      subject: { value: null, enumerable: true },
      value: {
        enumerable: true,
        get: () => {
          reads += 1;
          return reads === 1 ? 'first@example.test' : 'second@example.test';
        },
      },
    }) as PiiValue;
    const prepared = prepareEntry(
      { ...LOGIN, origin: { sourceApp: 'web', correlationId: 'corr-0013-forged' }, newValue: { e: forged } },
      OPTIONS,
    );
    expect(prepared.piiValues[0]).not.toBe(forged);
    expect(prepared.piiValues[0]?.value).toBe('first@example.test');
    expect(Object.isFrozen(prepared.piiValues[0])).toBe(true);
    expect(reads).toBe(1);
  });

  it('property: deep mutation of the input after prepareEntry never changes complete()', () => {
    const scramble = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach((item: unknown, index) => {
          scramble(item);
          (value as unknown[])[index] = marker;
        });
      } else if (typeof value === 'object' && value !== null) {
        for (const key of Object.keys(value)) {
          scramble((value as Record<string, unknown>)[key]);
          (value as Record<string, unknown>)[key] = marker;
        }
      }
    };
    fc.assert(
      fc.property(fc.jsonValue({ maxDepth: 4 }), (value) => {
        const text = JSON.stringify(value);
        fc.pre(!text.includes('"$pii"') && !text.includes('\\u0000'));
        const input = {
          ...LOGIN,
          origin: { sourceApp: 'api' as const, correlationId: 'corr-0014-prop' },
          details: JSON.parse(text) as AuditValue,
        };
        const prepared = prepareEntry(input, OPTIONS);
        const before = JSON.stringify(prepared.complete([]));
        scramble(input.details);
        expect(JSON.stringify(prepared.complete([]))).toBe(before);
      }),
      { seed: 89, numRuns: 150 },
    );
  });
});

describe('[PR #42 R2-n1] actor.roles: length read once, elements by index, the own map of the caller never called', () => {
  const plain = withOrigin({ ip: null, userAgent: null });
  const withRoles = (roles: unknown): AuditEntryInput =>
    ({ ...plain, actor: { type: 'USER', userId: USER, roles, sessionId: SESSION } }) as unknown as AuditEntryInput;

  it('an own map returning unvalidated values is never called: the elements are validated by index', () => {
    const roles = Object.assign(['Owner', 'Shipper'], {
      map: (): unknown[] => ['not a role key; DROP', 42],
    });
    expect(prepareEntry(withRoles(roles), OPTIONS).complete([]).actorRoles).toEqual(['Owner', 'Shipper']);
    const hostile = Object.assign(['Owner'], { map: (): unknown[] => ['Owner'] });
    hostile.push('has space');
    expect(refusal(withRoles(hostile)).field).toBe('actor.roles[1]');
  });

  it('a Proxy whose length answers 1 and then 40 yields one role; 40 then 1 is refused (MAX_ROLES)', () => {
    const flipping = (answers: number[]): { proxy: unknown; reads: () => number } => {
      let reads = 0;
      const target = new Array<string>(40).fill('Owner');
      const proxy = new Proxy(target, {
        get(inner, key, receiver) {
          if (key === 'length') {
            reads += 1;
            return answers[Math.min(reads, answers.length) - 1];
          }
          return Reflect.get(inner, key, receiver) as unknown;
        },
      });
      return { proxy, reads: () => reads };
    };
    const small = flipping([1, 40]);
    expect(prepareEntry(withRoles(small.proxy), OPTIONS).complete([]).actorRoles).toEqual(['Owner']);
    expect(small.reads()).toBe(1);
    const large = flipping([40, 1]);
    expect(refusal(withRoles(large.proxy)).field).toBe('actor.roles');
    expect(large.reads()).toBe(1);
  });

  it('a length that is not a number is refused (fail closed)', () => {
    const odd = new Proxy(['Owner'], {
      get: (inner, key, receiver) => (key === 'length' ? '1' : (Reflect.get(inner, key, receiver) as unknown)),
    });
    expect(kindOf(() => prepareEntry(withRoles(odd), OPTIONS))).toBe('INVALID_ENTRY');
  });
});

describe('[PR42-SEC-04] clear-text columns keep their shape (no query string, e-mail or raw user agent)', () => {
  it.each([
    ['route with a query string', withOrigin({ route: '/users?email=a@b.c' }), 'origin.route'],
    ['route with an address segment', withOrigin({ route: '/users/a@b.c' }), 'origin.route'],
    ['route with an empty segment', withOrigin({ route: '/a//b' }), 'origin.route'],
    ['route with a trailing slash', withOrigin({ route: '/a/' }), 'origin.route'],
    ['route percent-encoded', withOrigin({ route: '/u/%40x' }), 'origin.route'],
    ['route too long', withOrigin({ route: `/${'a'.repeat(256)}` }), 'origin.route'],
    ['entity id with an address', { ...LOGIN, entityId: 'a@b.c' }, 'entityId'],
    ['entity id with a space', { ...LOGIN, entityId: 'Jane Doe' }, 'entityId'],
    ['entity id with a slash', { ...LOGIN, entityId: 'a/b' }, 'entityId'],
    ['raw user agent as ua_parsed', withOrigin({ uaParsed: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }), 'origin.uaParsed'],
    ['address as ua_parsed', withOrigin({ uaParsed: 'a@b.c' }), 'origin.uaParsed'],
  ])('%s is refused', (_label, input, field) => {
    expect(refusal(input)).toMatchObject({ kind: 'INVALID_ENTRY', field });
  });

  it('templates, identifiers and parsed families are accepted', () => {
    for (const route of ['/', '/api/v1/users/:id', '/api/v1/users/{userId}/sessions', '/.well-known/jwks.json', '/auth/login']) {
      expect(prepareEntry(withOrigin({ route }), OPTIONS).complete(TOKENS.slice(0, 2)).route).toBe(route);
    }
    for (const entityId of [SESSION, 'SHP-2026-000123', '1Z999AA10123456784', 'org:42']) {
      expect(prepareEntry({ ...LOGIN, entityId }, OPTIONS).complete(TOKENS.slice(0, 2)).entityId).toBe(entityId);
    }
    for (const uaParsed of ['Firefox 146 / Windows', 'Mobile Safari UI/WKWebView 18 / iOS', 'Chrome 140 / Android (10)']) {
      expect(prepareEntry(withOrigin({ uaParsed }), OPTIONS).complete(TOKENS.slice(0, 2)).uaParsed).toBe(uaParsed);
    }
  });

  it('the shape checks run in bounded time on 32 KB inputs', () => {
    const big = 'a'.repeat(32 * 1024);
    const start = performance.now();
    for (const input of [withOrigin({ route: `/${big}` }), { ...LOGIN, entityId: big }, withOrigin({ uaParsed: big })]) {
      expect(kindOf(() => prepareEntry(input, OPTIONS))).toBe('INVALID_ENTRY');
    }
    expect(performance.now() - start).toBeLessThan(250);
  });
});

describe('[PR #42 R1-n3] the INVALID_ENTRY field path carries no business keys beyond the top level', () => {
  it('top-level schema keys stay readable; deeper keys and unsafe top-level keys become {key}; array indices stay', () => {
    expect(refusal({ ...LOGIN, newValue: { contacts: { 'jane@example.test': Number.NaN } } }).field).toBe('newValue.contacts.{key}');
    expect(refusal({ ...LOGIN, newValue: { 'jane@example.test': Number.NaN } }).field).toBe('newValue.{key}');
    expect(refusal({ ...LOGIN, newValue: { items: [{ name: Number.NaN }] } }).field).toBe('newValue.items[0].{key}');
  });

  it('[R1-n4] a failing IP index is IP_INDEX_FAILED with the cause kept off the error', () => {
    const cause = new Error('hmac');
    const error = refusal(LOGIN, {
      ...OPTIONS,
      ipIndex: {
        keyId: 'audit-index-v1',
        hash: () => {
          throw cause;
        },
      },
    });
    expect(error).toMatchObject({ kind: 'IP_INDEX_FAILED', reason: 'AUDIT_WRITE_FAILED' });
    expect(error.field).toBeUndefined();
    expect(auditErrorCause(error)).toBe(cause);
  });
});

describe('[PR42-SEC-15] shape predicates for request-built entries (null unless valid)', () => {
  it('isAuditEntityId accepts ids, codes and numbers; refuses e-mails, paths, query text and non-strings', () => {
    for (const ok of ['019a7c3e-0000-7000-8000-000000000001', 'SHP-2026-0001', '42', 'a.b:c_d-e']) expect(isAuditEntityId(ok)).toBe(true);
    for (const bad of ['a@b.example', 'a/b', 'a?b', 'a b', '', '-lead', 'x'.repeat(257), 42, null, undefined]) {
      expect(isAuditEntityId(bad)).toBe(false);
    }
  });

  it('isAuditUaParsed accepts a family / OS summary and refuses a raw user agent', () => {
    expect(isAuditUaParsed('Firefox 146 / Windows')).toBe(true);
    for (const bad of ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'a'.repeat(121), '', 7]) expect(isAuditUaParsed(bad)).toBe(false);
  });

  it('isAuditRouteTemplate accepts templates and refuses concrete URLs and non-strings', () => {
    for (const ok of ['/', '/api/v1/addresses', '/api/v1/shipments/:shipmentId', '/shipments/{shipmentId}']) {
      expect(isAuditRouteTemplate(ok)).toBe(true);
    }
    for (const bad of ['/api/v1/users/a@b.example', '/x?y=1', 'relative', '', null, undefined, 5])
      expect(isAuditRouteTemplate(bad)).toBe(false);
  });
});
