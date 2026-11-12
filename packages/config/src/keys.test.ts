import { generateKeyPairSync, randomBytes } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import {
  findDuplicateKeyMaterial,
  KEY_REGISTER,
  type KeyVersion,
  parseKeySet,
  parseKeyVersion,
  parsePublicKeySet,
  PREVIOUS_SUFFIX,
  registerEntryFor,
} from './keys.js';
import { CONFIG_SCHEMA, type ConfigKey } from './schema.js';
import { Secret } from './secret.js';
import { TOOLING_CONFIG_KEYS, TOOLING_KEY_NAMES } from './tooling-keys.js';
import { keyValueFor, p256PrivateKeyValue, p256PublicKeyValue, randomKeyValue } from './testing/test-env.js';

const schemaKeys = new Set<string>(Object.keys(CONFIG_SCHEMA));
const entry = (variable: string) => registerEntryFor(variable);
const rule = (result: { ok: boolean; rule?: string }) => (result.ok ? 'ok' : result.rule);

describe('key and secret register (ADR-0018 amendment item 1, SEC-P3-08) @security', () => {
  it('[SEC-TC-49] holds the 25 ADR-0018 rows, each with a unique key_id', () => {
    expect(KEY_REGISTER).toHaveLength(25);
    const ids = KEY_REGISTER.map((row) => row.keyId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const row of KEY_REGISTER) {
      expect(row.keyId).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
      for (const field of [row.algorithm, row.purpose, row.storage, row.rotation, row.blastRadius]) expect(field.length).toBeGreaterThan(0);
      expect(row.holders.length).toBeGreaterThan(0);
      for (const service of row.requiredFor) expect(row.holders).toContain(service);
    }
  });

  it('[SEC-TC-49] every register variable is a secret key of the runtime schema or the tooling set, and vice versa', () => {
    const registered = KEY_REGISTER.flatMap((row) => row.variables);
    expect(new Set(registered).size).toBe(registered.length);
    for (const variable of registered) {
      const tooling = TOOLING_CONFIG_KEYS.find((key) => key.name === variable);
      expect({ variable, known: schemaKeys.has(variable) !== (tooling !== undefined) }).toEqual({ variable, known: true });
      expect(['secret', 'secret-ref']).toContain(tooling?.sensitivity ?? CONFIG_SCHEMA[variable as ConfigKey].sensitivity);
    }
    for (const key of TOOLING_CONFIG_KEYS) {
      expect(registered).toContain(key.name);
      expect(registerEntryFor(key.name).holders).toEqual(expect.arrayContaining([...key.holders]));
    }
    const secretKeys = (Object.keys(CONFIG_SCHEMA) as ConfigKey[]).filter(
      (name) => CONFIG_SCHEMA[name].sensitivity !== 'public' && CONFIG_SCHEMA[name].sensitivity !== 'internal',
    );
    const unregistered = secretKeys.filter(
      (name) => !registered.includes(name) && !name.endsWith(PREVIOUS_SUFFIX) && !name.startsWith('SEED_'),
    );
    expect(unregistered).toEqual([]);
  });

  it('[SEC-TC-49] exactly the dual-read rows have a <NAME>_PREVIOUS key', () => {
    for (const row of KEY_REGISTER) {
      for (const variable of row.variables) expect(schemaKeys.has(`${variable}${PREVIOUS_SUFFIX}`)).toBe(row.dualRead);
    }
  });

  it('[m9] the tooling key set is exactly the TASK-003 names and stays out of the runtime schema', () => {
    expect(TOOLING_KEY_NAMES).toEqual([
      'DATABASE_MIGRATOR_URL',
      'SHADOW_DATABASE_URL',
      'DATABASE_BOOTSTRAP_URL',
      'BOOTSTRAP_MIGRATOR_PASSWORD',
      'BOOTSTRAP_MIGRATOR_PASSWORD_FILE',
      'BOOTSTRAP_APP_PASSWORD',
      'BOOTSTRAP_APP_PASSWORD_FILE',
    ]);
    expect(TOOLING_KEY_NAMES.filter((name) => schemaKeys.has(name))).toEqual([]);
    for (const key of TOOLING_CONFIG_KEYS) {
      expect(key.sensitivity).toBe(key.name.endsWith('_FILE') ? 'secret-ref' : 'secret');
      expect(key.holders.every((holder) => holder === 'migrate' || holder === 'bootstrap')).toBe(true);
      expect(Object.isFrozen(key)).toBe(true);
    }
    expect(registerEntryFor('DATABASE_URL').requiredFor).toEqual(['api', 'worker']);
  });

  it('rejects a lookup of a variable outside the register', () => {
    expect(() => registerEntryFor('APP_PORT')).toThrow('APP_PORT is not in the key register');
  });
});

describe('key variable parser (<key_id>:<base64>)', () => {
  it('parses a symmetric key and keeps the material out of every serialisation', () => {
    const value = randomKeyValue('cursor-v3');
    const result = parseKeyVersion(entry('CURSOR_KEY'), value);
    if (!result.ok) throw new Error(result.rule);
    expect(result.value).toMatchObject({ keyId: 'cursor-v3', purpose: 'cursor', version: 3, localOnly: false });
    expect(Buffer.from(result.value.material.reveal()).toString('base64')).toBe(value.split(':')[1]);
    expect(JSON.stringify(result.value)).not.toContain(value.split(':')[1]);
  });

  it.each([
    ['no separator', 'abc', 'key.idMissing'],
    ['empty key_id', ':abc', 'key.idMissing'],
    ['key_id without version', 'cursor:AAAA', 'key.idFormat'],
    ['version zero', 'cursor-v0:AAAA', 'key.idFormat'],
    ['upper-case key_id', 'Cursor-v1:AAAA', 'key.idFormat'],
    ['other purpose', 'csrf-v1:AAAA', 'key.purpose'],
    ['empty material', 'cursor-v1:', 'key.encoding'],
    ['not base64', 'cursor-v1:not_base64!', 'key.encoding'],
    ['bad padding', 'cursor-v1:AAA', 'key.encoding'],
  ])('rejects %s', (_label, value, expected) => {
    expect(rule(parseKeyVersion(entry('CURSOR_KEY'), value))).toBe(expected);
  });

  it('enforces 32 bytes for AES-256-GCM and at least 32 bytes for HMAC', () => {
    expect(rule(parseKeyVersion(entry('MFA_ENCRYPTION_KEY'), randomKeyValue('mfa-v1', 33)))).toBe('key.length');
    expect(rule(parseKeyVersion(entry('MFA_ENCRYPTION_KEY'), randomKeyValue('mfa-v1', 32)))).toBe('ok');
    expect(rule(parseKeyVersion(entry('CSRF_KEY'), randomKeyValue('csrf-v1', 64)))).toBe('ok');
    expect(rule(parseKeyVersion(entry('CSRF_KEY'), randomKeyValue('csrf-v1', 16)))).toBe('key.length');
  });

  it('property: every random key of the right size parses for every symmetric row', () => {
    const rows = KEY_REGISTER.filter((row) => row.material === 'hmac-sha256' || row.material === 'aes-256-gcm');
    fc.assert(
      fc.property(
        fc.constantFrom(...rows),
        fc.integer({ min: 1, max: 999 }),
        fc.uint8Array({ minLength: 32, maxLength: 32 }),
        (row, version, bytes) => {
          const [variable = ''] = row.variables;
          const result = parseKeyVersion(entry(variable), `${row.keyId}-v${version}:${Buffer.from(bytes).toString('base64')}`);
          expect(result.ok && result.value.version === version).toBe(true);
        },
      ),
    );
  });

  it('accepts a visible local-only marker as material and flags it', () => {
    const result = parseKeyVersion(entry('AUDIT_ANCHOR_SIGNING_KEY'), 'audit-anchor-v1:local-only-audit-anchor-signing-key');
    expect(result.ok && result.value.localOnly).toBe(true);
  });

  it('accepts only P-256 PKCS#8 keys for the ES256 and anchor rows', () => {
    expect(rule(parseKeyVersion(entry('AUDIT_ANCHOR_SIGNING_KEY'), p256PrivateKeyValue('audit-anchor-v1')))).toBe('ok');
    const p384 = generateKeyPairSync('ec', { namedCurve: 'P-384' }).privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
    expect(rule(parseKeyVersion(entry('AUDIT_ANCHOR_SIGNING_KEY'), `audit-anchor-v1:${p384}`))).toBe('key.type');
    expect(rule(parseKeyVersion(entry('AUDIT_ANCHOR_SIGNING_KEY'), randomKeyValue('audit-anchor-v1')))).toBe('key.type');
  });

  it('never treats a credential row as a key', () => {
    expect(rule(parseKeyVersion(entry('DATABASE_URL'), randomKeyValue('db-v1')))).toBe('key.notAKey');
  });

  it('parses JWT key sets of one or two kids with distinct ids', () => {
    const jwt = entry('JWT_SIGNING_KEYS');
    const two = parseKeySet(jwt, `${p256PrivateKeyValue('jwt-signing-v2')}, ${p256PrivateKeyValue('jwt-signing-v1')}`);
    expect(two.ok && two.value.map((key) => key.keyId)).toEqual(['jwt-signing-v2', 'jwt-signing-v1']);
    const three = [1, 2, 3].map((n) => p256PrivateKeyValue(`jwt-signing-v${n}`)).join(',');
    expect(rule(parseKeySet(jwt, three))).toBe('key.count');
    expect(rule(parseKeySet(jwt, `${p256PrivateKeyValue('jwt-signing-v1')},`))).toBe('key.count');
    const sameId = `${p256PrivateKeyValue('jwt-signing-v1')},${p256PrivateKeyValue('jwt-signing-v1')}`;
    expect(rule(parseKeySet(jwt, sameId))).toBe('key.duplicateId');
    expect(rule(parseKeySet(jwt, 'jwt-signing-v1:AAAA'))).toBe('key.type');
  });

  it('parses anchor public key sets and rejects private or foreign keys', () => {
    const set = parsePublicKeySet('audit-anchor', `${p256PublicKeyValue('audit-anchor-v1')},${p256PublicKeyValue('audit-anchor-v2')}`);
    expect(set.ok && set.value.map((key) => key.version)).toEqual([1, 2]);
    expect(rule(parsePublicKeySet('audit-anchor', p256PrivateKeyValue('audit-anchor-v1')))).toBe('key.type');
    expect(rule(parsePublicKeySet('audit-anchor', p256PublicKeyValue('jwt-signing-v1')))).toBe('key.purpose');
    const local = parsePublicKeySet('audit-anchor', 'audit-anchor-v1:local-only-audit-anchor-public-key');
    expect(local.ok && local.value[0]?.localOnly).toBe(true);
  });

  it('every register key row accepts the generated test value', () => {
    for (const row of KEY_REGISTER.filter((candidate) => candidate.material !== 'credential')) {
      const [variable = ''] = row.variables;
      const value = keyValueFor(row, 4);
      const parsed = row.material === 'es256-key-set' ? parseKeySet(row, value) : parseKeyVersion(entry(variable), value);
      expect(rule(parsed)).toBe('ok');
    }
  });
});

describe('duplicate key material (SEC-TC-49) @security', () => {
  const version = (bytes: Uint8Array, keyId = 'x-v1'): KeyVersion => ({
    keyId,
    purpose: 'x',
    version: 1,
    localOnly: false,
    material: new Secret(bytes),
  });

  it('[SEC-TC-49] names every variable sharing material and nothing else', () => {
    const shared = randomBytes(32);
    const keys = new Map<string, readonly KeyVersion[]>([
      ['B_KEY', [version(shared)]],
      ['A_KEY', [version(Buffer.from(shared))]],
      ['C_KEY', [version(randomBytes(32))]],
    ]);
    expect(findDuplicateKeyMaterial(keys)).toEqual(['A_KEY', 'B_KEY']);
  });

  it('[SEC-TC-49] property: distinct random keys are never reported', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.uint8Array({ minLength: 32, maxLength: 32 }), {
          minLength: 2,
          maxLength: 8,
          selector: (b) => Buffer.from(b).toString('hex'),
        }),
        (all) => {
          const keys = new Map(all.map((bytes, index) => [`K${index}`, [version(bytes)]] as const));
          expect(findDuplicateKeyMaterial(keys)).toEqual([]);
        },
      ),
    );
  });
});
