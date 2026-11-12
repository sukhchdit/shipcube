import type { ReactNode } from 'react';

export interface SkipLinkProps {
  /** Id of the element to jump to, normally the page `main` landmark (accessibility.md §2). */
  targetId: string;
  /** Localised label; the kit holds no strings (US-115). */
  children: ReactNode;
}

/**
 * First focusable element of every page (US-108). Hidden until it receives keyboard focus, then shown above the
 * header on the inline-start edge. Logical positioning only (NFR-I18N-003); colours come from the token theme.
 */
export function SkipLink({ targetId, children }: SkipLinkProps) {
  return (
    <a
      href={`#${targetId}`}
      className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:inset-bs-4 focus:z-(--z-skip-link) focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-link focus:underline"
    >
      {children}
    </a>
  );
}
