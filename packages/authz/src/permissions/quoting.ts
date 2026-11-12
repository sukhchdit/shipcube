/** Quoting-context permissions (REQ-RBAC-014; quote save, claim, list, share and delete routes). */
import type { PermissionDefinition } from './types.js';

export const QUOTING_PERMISSIONS = [
  { key: 'quote:create', description: 'Save or claim a quote into the organisation.', category: 'quote', operatorOnly: false },
  { key: 'quote:read', description: 'List and view saved quotes of the organisation.', category: 'quote', operatorOnly: false },
  { key: 'quote:share', description: 'Create or revoke a public share link for a quote.', category: 'quote', operatorOnly: false },
  { key: 'quote:delete', description: 'Delete a saved quote.', category: 'quote', operatorOnly: false },
] as const satisfies readonly PermissionDefinition[];
