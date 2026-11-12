import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { UserConfig } from 'vite';

// The Vite plugins are replaced by stubs: they register Node module hooks, which Jest refuses to load, and this test
// reads only the plain configuration object.
jest.mock('@tailwindcss/vite', () => ({ __esModule: true, default: () => ({ name: 'tailwindcss-stub' }) }));
jest.mock('@react-router/dev/vite', () => ({ __esModule: true, reactRouter: () => ({ name: 'react-router-stub' }) }));

describe('apps/web vite config (ADR-0018 item 1, PR4-SEC-01)', () => {
  let config: UserConfig;
  beforeAll(async () => {
    config = (await import('./vite.config')).default as UserConfig;
  });

  it('exposes only VITE_PUBLIC_* variables to the client bundle', () => {
    expect(config.envPrefix).toBe('VITE_PUBLIC_');
  });

  it('never publishes source maps', () => {
    expect(config.build?.sourcemap).toBeFalsy();
  });
});
