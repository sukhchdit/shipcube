/**
 * Test-only environment builders. Every secret is generated at run time (`crypto.randomBytes`,
 * `generateKeyPairSync`), so no secret value exists in code, tests or fixtures (CLAUDE.md §5, brief §13 rule 9).
 * Each call returns fresh material.
 */
import { generateKeyPairSync, randomBytes } from 'node:crypto';

import type { AppEnv } from '../environment.js';
import { KEY_REGISTER, type KeyRegisterEntry, MIN_SYMMETRIC_KEY_BYTES } from '../keys.js';

const randomToken = (bytes = 18): string => randomBytes(bytes).toString('hex');

/** `<keyId>:<base64>` with `bytes` random bytes. */
export function randomKeyValue(keyId: string, bytes = MIN_SYMMETRIC_KEY_BYTES): string {
  return `${keyId}:${randomBytes(bytes).toString('base64')}`;
}

function p256KeyPair(): { privateDer: Buffer; publicDer: Buffer } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    privateDer: privateKey.export({ format: 'der', type: 'pkcs8' }),
    publicDer: publicKey.export({ format: 'der', type: 'spki' }),
  };
}

/** `<keyId>:<base64 PKCS#8 DER>` of a fresh P-256 private key. */
export function p256PrivateKeyValue(keyId: string): string {
  return `${keyId}:${p256KeyPair().privateDer.toString('base64')}`;
}

/** `<keyId>:<base64 SPKI DER>` of a fresh P-256 public key. */
export function p256PublicKeyValue(keyId: string): string {
  return `${keyId}:${p256KeyPair().publicDer.toString('base64')}`;
}

/** A valid value for a key-material register entry, version 1. */
export function keyValueFor(entry: KeyRegisterEntry, version = 1): string {
  const keyId = `${entry.keyId}-v${version}`;
  return entry.material === 'es256-key-set' || entry.material === 'ecdsa-p256-private' ? p256PrivateKeyValue(keyId) : randomKeyValue(keyId);
}

export interface TestEnvOptions {
  readonly appEnv?: AppEnv;
}

/**
 * A complete, valid environment for the API and the worker. For staging and production the URLs use TLS and
 * the payment adapter matches the environment default (Mock below production, Stripe references in production).
 */
export function createTestEnv(options: TestEnvOptions = {}): Record<string, string> {
  const appEnv = options.appEnv ?? 'test';
  const hardened = appEnv === 'staging' || appEnv === 'production';
  const scheme = hardened ? 'https' : 'http';
  const env: Record<string, string> = {
    APP_ENV: appEnv,
    NODE_ENV: hardened ? 'production' : 'test',
    WEB_APP_ORIGIN: `${scheme}://web.${appEnv}.test`,
    ADMIN_APP_ORIGIN: `${scheme}://admin.${appEnv}.test`,
    BRAND_NAME: 'Test Brand',
    DATABASE_URL: `postgresql://platform_app:${randomToken()}@db.${appEnv}.test:5432/platform?sslmode=${hardened ? 'verify-full' : 'disable'}`,
    REDIS_URL: `${hardened ? 'rediss' : 'redis'}://api:${randomToken()}@cache.${appEnv}.test:6379`,
    STORAGE_BUCKET_DOCUMENTS: `documents-${appEnv}`,
    STORAGE_BUCKET_RAW_CARRIER_PAYLOADS: `raw-carrier-payloads-${appEnv}`,
    MAIL_HOST: `mail.${appEnv}.test`,
    MAIL_FROM: `no-reply@${appEnv}.test`,
    AUDIT_ANCHOR_SINK: hardened ? `s3://audit-anchors-${appEnv}/${appEnv}/` : 'file:///data/audit-anchors/anchors.ndjson',
    AUDIT_ANCHOR_PUBLIC_KEYS: p256PublicKeyValue('audit-anchor-v1'),
  };
  for (const entry of KEY_REGISTER) {
    if (entry.material === 'credential') continue;
    const [variable] = entry.variables;
    if (variable === undefined || (variable === 'MOCK_GATEWAY_WEBHOOK_SECRET' && appEnv === 'production')) continue;
    env[variable] = keyValueFor(entry);
  }
  if (appEnv === 'production') {
    env.STRIPE_SECRET_KEY_REF = 'aws-secrets-manager:stripe/restricted-key';
    env.STRIPE_WEBHOOK_SECRET_REF = 'aws-secrets-manager:stripe/webhook/api';
  }
  return env;
}
