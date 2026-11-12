/**
 * `.env.example` parity with the configuration schemas (NFR-OPS-005, REQ-SEC-011; suite `config-guards`):
 * 0 undocumented keys, 0 unknown keys, 0 secret-looking example values, and every secret is a placeholder.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { ConfigValidationError, isPlaceholder, KEY_REGISTER, loadConfig, TOOLING_KEY_NAMES } from '@platform/config';

import { findRepoRoot } from '../test-support/process.js';
import {
  ALL_CONFIG_KEYS,
  checkEnvExampleParity,
  looksLikeSecret,
  parseEnvFile,
  requiredSecretsLeftEmpty,
  TOOLING_SECRET_KEYS,
} from './env-file.js';

const exampleText = readFileSync(join(findRepoRoot(), '.env.example'), 'utf8');
const clean = { missing: [], unknown: [], duplicates: [], malformedLines: [], secretsWithoutPlaceholder: [], secretLookingValues: [] };

describe('.env.example parity (NFR-OPS-005)', () => {
  it('[NT-OPS-005-a] lists every schema key once, no unknown key, placeholders only', () => {
    expect(checkEnvExampleParity(exampleText)).toEqual(clean);
  });

  it('[NT-OPS-005-a] fails when a schema key is missing from .env.example', () => {
    const withoutKey = exampleText.replace(/^AUTH_BCRYPT_COST=.*$/m, '');
    expect(checkEnvExampleParity(withoutKey).missing).toEqual(['AUTH_BCRYPT_COST']);
  });

  it('[NT-OPS-005-a] fails when .env.example has a key the schema does not know', () => {
    const report = checkEnvExampleParity(`${exampleText}\nLEGACY_FLAG=true\nAPP_PORT=3001\nnot an assignment\n`);
    expect(report.unknown).toEqual(['LEGACY_FLAG']);
    expect(report.duplicates).toEqual(['APP_PORT']);
    expect(report.malformedLines).toHaveLength(1);
  });

  it('[SEC-TC-51] every secret in .env.example is a placeholder, so start-up refuses it in staging', () => {
    const generated = `v${Date.now().toString(36)}AbCdEfGhIjKlMnOp`;
    const tampered = exampleText.replace(/^CSRF_KEY=.*$/m, `CSRF_KEY=csrf-v1:${generated}`);
    expect(checkEnvExampleParity(tampered).secretsWithoutPlaceholder).toEqual(['CSRF_KEY']);
    expect(requiredSecretsLeftEmpty(exampleText)).toEqual([]);
    const { entries } = parseEnvFile(exampleText);
    const staging = { ...Object.fromEntries(entries), APP_ENV: 'staging' };
    let refused: ConfigValidationError | undefined;
    try {
      loadConfig(staging, { service: 'api' });
    } catch (error) {
      if (error instanceof ConfigValidationError) refused = error;
    }
    const keysWith = (code: string): readonly string[] =>
      refused?.issues.filter((issue) => issue.code === code).map((issue) => issue.key) ?? [];
    const placeholders = keysWith('placeholder');
    // Tooling keys never load into the API config; outside local/test their mere presence is refused.
    const forbidden = keysWith('forbidden-in-environment');
    for (const [key, value] of entries) {
      if (TOOLING_KEY_NAMES.includes(key)) {
        if (value !== '') expect(forbidden).toContain(key);
      } else if (value !== '' && isPlaceholder(value)) {
        expect(placeholders).toContain(key);
      }
    }
  });

  it('[m9] documents the tooling keys (TASK-003 names) with placeholders or empty values only', () => {
    const { entries } = parseEnvFile(exampleText);
    for (const key of TOOLING_KEY_NAMES) expect(entries.has(key)).toBe(true);
    for (const key of TOOLING_SECRET_KEYS) {
      const value = entries.get(key) ?? '';
      expect({ key, placeholderOrEmpty: value === '' || isPlaceholder(value) }).toEqual({ key, placeholderOrEmpty: true });
    }
    expect(entries.get('DB_IDLE_TIMEOUT_MS')).toBe('10000');
    expect(entries.get('DB_CONNECTION_TIMEOUT_MS')).toBe('5000');
  });

  it('[NT-OPS-005-a] non-secret example values never look like credentials', () => {
    const tampered = exampleText.replace(/^BRAND_LOGO_URL=.*$/m, 'BRAND_LOGO_URL=https://user:pass@cdn.example.org/logo.svg');
    expect(checkEnvExampleParity(tampered).secretLookingValues).toEqual(['BRAND_LOGO_URL']);
    expect(looksLikeSecret('https://localhost:8443')).toBe(false);
    // Assembled at run time so no PEM header literal sits in the repository for secret scanners.
    expect(looksLikeSecret(['-----BEGIN', 'EC', 'PRIVATE', 'KEY-----'].join(' '))).toBe(true);
  });

  it('key variables in .env.example document their key_id format', () => {
    const { entries } = parseEnvFile(exampleText);
    for (const row of KEY_REGISTER.filter((entry) => entry.material !== 'credential')) {
      for (const variable of row.variables) expect(entries.get(variable)).toBe(`${row.keyId}-v1:CHANGE_ME`);
    }
    expect(ALL_CONFIG_KEYS).toContain('VITE_API_BASE_URL');
  });
});
