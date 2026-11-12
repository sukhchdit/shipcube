/**
 * Web and admin build-time configuration loader (REQ-PLAT-004, AT-US-002-04). Pure: the build passes its
 * environment (`loadEnv(...)` in vite.config.ts or `process.env`). Failures throw the same
 * `ConfigValidationError` as the API and worker, naming keys only.
 */
import { deepFreeze, type EnvInput, pickConfigured } from '../env-input.js';
import { type ConfigIssue, ConfigValidationError } from '../errors.js';
import { WEB_CONFIG_KEYS, type WebBuildConfig, webConfigSchema } from './web-schema.js';

const STRIPE_LIVE_PUBLISHABLE_KEY = /^pk_live_/;

export function loadWebBuildConfig(env: EnvInput): Readonly<WebBuildConfig> {
  const raw = pickConfigured(env, WEB_CONFIG_KEYS);
  const issues: ConfigIssue[] = [];
  const stripeKey = raw.VITE_STRIPE_PUBLISHABLE_KEY;
  if (stripeKey !== undefined && STRIPE_LIVE_PUBLISHABLE_KEY.test(stripeKey)) {
    issues.push({ key: 'VITE_STRIPE_PUBLISHABLE_KEY', code: 'live-key-forbidden' });
  }
  const flagged = new Set(issues.map((issue) => issue.key));
  const result = webConfigSchema.safeParse(raw);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const key = String(issue.path[0] ?? '(root)');
      if (!flagged.has(key)) issues.push({ key, code: key in raw ? 'invalid' : 'missing', rule: issue.code });
    }
  }
  if (issues.length > 0 || !result.success) throw new ConfigValidationError(issues);
  return deepFreeze(result.data);
}

/**
 * Vite `define` entries (`import.meta.env.<KEY>` → JSON literal) for every configured key. The input is the
 * validated config, so only public keys can reach the bundle.
 */
export function webBuildDefine(config: Readonly<WebBuildConfig>): Readonly<Record<string, string>> {
  const define: Record<string, string> = {};
  for (const [key, value] of Object.entries(config)) {
    if (value !== undefined) define[`import.meta.env.${key}`] = JSON.stringify(value);
  }
  return Object.freeze(define);
}
