import { randomBytes } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';

import { ConfigValidationError } from '../errors.js';
import { CONFIG_SCHEMA, type ConfigKey, SECRET_KEY_NAMES } from '../schema.js';
import { createTestEnv } from '../testing/test-env.js';
import * as webEntry from './index.js';
import { loadWebBuildConfig, webBuildDefine } from './load-web-config.js';
import { WEB_CONFIG_KEYS } from './web-schema.js';

const baseWebEnv = { BRAND_NAME: 'Test Brand', VITE_API_BASE_URL: '/api' };

function rejection(fn: () => unknown): ConfigValidationError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ConfigValidationError) return error;
    throw error;
  }
  throw new Error('expected a ConfigValidationError');
}

describe('web build configuration (ADR-0018 §1, US-002)', () => {
  it('[AT-US-002-04] loads public keys with defaults', () => {
    const config = loadWebBuildConfig(baseWebEnv);
    expect(config).toEqual({ BRAND_NAME: 'Test Brand', VITE_API_BASE_URL: '/api', VITE_LOCALES: ['en', 'es', 'fr'] });
    expect(Object.isFrozen(config.VITE_LOCALES)).toBe(true);
  });

  it('[AT-US-002-04] lists every missing and invalid key by name', () => {
    const error = rejection(() => loadWebBuildConfig({ VITE_LOCALES: 'en,de', BRAND_LOGO_URL: 'javascript:alert(1)' }));
    expect(error.keys).toEqual(['BRAND_LOGO_URL', 'BRAND_NAME', 'VITE_API_BASE_URL', 'VITE_LOCALES']);
    expect(error.missingKeys).toEqual(['BRAND_NAME', 'VITE_API_BASE_URL']);
    expect(error.message).not.toContain('javascript:');
  });

  it('rejects duplicate locales and protocol-relative URLs', () => {
    const error = rejection(() =>
      loadWebBuildConfig({ ...baseWebEnv, VITE_LOCALES: 'en,en', VITE_FEATURE_FLAGS_ENDPOINT: '//evil.example' }),
    );
    expect(error.keys).toEqual(['VITE_FEATURE_FLAGS_ENDPOINT', 'VITE_LOCALES']);
  });

  it('accepts a test-mode publishable key and refuses a live one @security', () => {
    const test = `pk_test_${randomBytes(12).toString('hex')}`;
    expect(loadWebBuildConfig({ ...baseWebEnv, VITE_STRIPE_PUBLISHABLE_KEY: test }).VITE_STRIPE_PUBLISHABLE_KEY).toBe(test);
    const live = `pk_live_${randomBytes(12).toString('hex')}`;
    const error = rejection(() => loadWebBuildConfig({ ...baseWebEnv, VITE_STRIPE_PUBLISHABLE_KEY: live }));
    expect(error.issues).toEqual([{ key: 'VITE_STRIPE_PUBLISHABLE_KEY', code: 'live-key-forbidden' }]);
  });

  it('only public keys can reach a bundle: no web key is a backend secret, and secrets are dropped @security', () => {
    for (const key of WEB_CONFIG_KEYS) {
      expect(key).toMatch(/^(VITE|BRAND)_/);
      expect(SECRET_KEY_NAMES).not.toContain(key);
      if (key in CONFIG_SCHEMA) expect(CONFIG_SCHEMA[key as ConfigKey].sensitivity).toBe('public');
    }
    const env: Record<string, string> = { ...createTestEnv(), ...baseWebEnv };
    const define = webBuildDefine(loadWebBuildConfig(env));
    const bundle = JSON.stringify(define);
    for (const name of SECRET_KEY_NAMES) {
      const value = env[name];
      if (value !== undefined) expect(bundle).not.toContain(value);
    }
  });

  it('produces Vite define entries for configured keys only', () => {
    const define = webBuildDefine(loadWebBuildConfig({ ...baseWebEnv, VITE_LOCALES: 'fr, en' }));
    expect(define).toEqual({
      'import.meta.env.BRAND_NAME': '"Test Brand"',
      'import.meta.env.VITE_API_BASE_URL': '"/api"',
      'import.meta.env.VITE_LOCALES': '["fr","en"]',
    });
  });

  it('the @platform/config/web entry exposes the loader and the schema', () => {
    expect(webEntry.loadWebBuildConfig).toBe(loadWebBuildConfig);
    expect(webEntry.webBuildDefine).toBe(webBuildDefine);
    expect(webEntry.WEB_CONFIG_KEYS).toBe(WEB_CONFIG_KEYS);
    expect(webEntry.LOCALES).toEqual(['en', 'es', 'fr']);
    expect(Object.keys(webEntry.BRAND_VALUE_SCHEMAS)).toEqual(['BRAND_NAME', 'BRAND_LOGO_URL', 'BRAND_LOGO_DARK_URL', 'BRAND_FAVICON_URL']);
    expect(webEntry.webConfigSchema.shape.BRAND_NAME).toBeDefined();
    expect(new webEntry.ConfigValidationError([{ key: 'X', code: 'missing' }]).keys).toEqual(['X']);
    expect(webEntry.formatConfigError(new webEntry.ConfigValidationError([{ key: 'X', code: 'missing' }]))).toContain('X: missing');
  });
});
