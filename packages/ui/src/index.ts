// Public entry point of @platform/ui. Design-system components on Radix primitives and the Tailwind token theme (ADR-0026).
// The theme stylesheet is a separate export (`@platform/ui/theme.css`) because CSS is not part of the module graph.
// Exports are added by the tasks that implement this package.
export { SkipLink, type SkipLinkProps } from './skip-link.js';
