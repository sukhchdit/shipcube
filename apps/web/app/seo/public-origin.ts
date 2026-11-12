/** Origin used when `VITE_PUBLIC_ORIGIN` is not set: the local edge on :8080 (platform.md §2). */
export const LOCAL_ORIGIN = 'http://localhost:8080';

/**
 * Normalises the configured public origin. A value that is not an absolute http(s) URL fails the build instead of
 * producing canonical and hreflang tags that crawlers would ignore.
 */
export function resolvePublicOrigin(configured: string | undefined): string {
  if (configured === undefined || configured === '') return LOCAL_ORIGIN;
  const url = new URL(configured);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`VITE_PUBLIC_ORIGIN must be an http(s) origin, got "${configured}"`);
  }
  return url.origin;
}

/**
 * Public origin baked into canonical and hreflang URLs at build time (NFR-WEB-005): `VITE_PUBLIC_ORIGIN`, which Vite
 * inlines. Outside Vite (Jest) `import.meta.env` does not exist, hence the cast.
 */
export function publicOrigin(): string {
  const env = (import.meta as { env?: { VITE_PUBLIC_ORIGIN?: string } }).env;
  return resolvePublicOrigin(env?.VITE_PUBLIC_ORIGIN);
}
