/** The admin app is never indexed (ADR-0026 am. 5; Nginx also sends `X-Robots-Tag`). */
export const ROBOTS_DIRECTIVES = 'noindex, nofollow';

/**
 * Static robots tag of the document shell. React Router keeps only the deepest route's `meta` after hydration, which
 * drops the one exported by the root, so the tag is rendered by the shell as well (PR4-SEC-05).
 */
export function NoIndex() {
  return <meta name="robots" content={ROBOTS_DIRECTIVES} />;
}
