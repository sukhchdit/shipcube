/**
 * Build-time configuration of apps/web and apps/admin (ADR-0018 §1: a Zod schema in `config/web`, consumed by
 * Vite's `define`). Only public keys live here: `VITE_*` and `BRAND_*`. Secrets can never be part of a frontend
 * bundle; the web-config test asserts that no key of this schema is a secret in the backend schema.
 *
 * The `BRAND_*` value schemas are shared with the backend Joi schema, which delegates to them, so the API, the
 * worker and both frontend builds validate brand values with one definition (AT-US-002-04).
 */
import { z } from 'zod';

export const LOCALES = ['en', 'es', 'fr'] as const;
export type Locale = (typeof LOCALES)[number];

const httpUrl = z.url({ protocol: /^https?$/ });
/** Root-relative path (same origin through the edge); protocol-relative `//host` is not a path. */
const rootPath = z.string().regex(/^\/(?!\/)[A-Za-z0-9._~\-/]*$/);
const urlOrRootPath = z.union([httpUrl, rootPath]);

/** `BRAND_*` value schemas (tokens.md §11): shared by the backend schema and the web build. */
export const BRAND_VALUE_SCHEMAS = {
  BRAND_NAME: z.string().trim().min(1).max(40),
  BRAND_LOGO_URL: urlOrRootPath,
  BRAND_LOGO_DARK_URL: urlOrRootPath,
  BRAND_FAVICON_URL: urlOrRootPath,
} as const;

const localeList = z
  .string()
  .transform((value) => value.split(',').map((locale) => locale.trim()))
  .pipe(
    z
      .array(z.enum(LOCALES))
      .min(1)
      .refine((locales) => new Set(locales).size === locales.length),
  );

export const webConfigSchema = z.object({
  BRAND_NAME: BRAND_VALUE_SCHEMAS.BRAND_NAME,
  BRAND_LOGO_URL: BRAND_VALUE_SCHEMAS.BRAND_LOGO_URL.optional(),
  BRAND_LOGO_DARK_URL: BRAND_VALUE_SCHEMAS.BRAND_LOGO_DARK_URL.optional(),
  BRAND_FAVICON_URL: BRAND_VALUE_SCHEMAS.BRAND_FAVICON_URL.optional(),
  /** API base: absolute http(s) URL or a root-relative path such as `/api` behind the edge. */
  VITE_API_BASE_URL: urlOrRootPath,
  /** Stripe publishable key, test mode only until G4 (`pk_live_` is refused). */
  VITE_STRIPE_PUBLISHABLE_KEY: z
    .string()
    .regex(/^pk_test_[A-Za-z0-9]+$/)
    .optional(),
  /** Comma-separated UI locales, a subset of en, es, fr. */
  VITE_LOCALES: localeList.default([...LOCALES]),
  /** Feature-flag evaluation endpoint (ADR-0027); absolute URL or root-relative path. */
  VITE_FEATURE_FLAGS_ENDPOINT: urlOrRootPath.optional(),
});

export type WebBuildConfig = z.output<typeof webConfigSchema>;

/** Every key the web build reads, in schema order. */
export const WEB_CONFIG_KEYS: readonly string[] = Object.freeze(Object.keys(webConfigSchema.shape));
