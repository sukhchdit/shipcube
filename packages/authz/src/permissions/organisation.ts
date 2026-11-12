/**
 * Organisation-context permissions: profile, members, invitations and the address book (REQ-RBAC-001/014).
 * REQ-RBAC-001 lists `org:member:invite` and `org:member:manage`, REQ-RBAC-014 only the latter: both exist (US-065
 * note) and guard different routes (invitations vs. membership changes). `org:read:any_org` is the cross-tenant
 * operator read seam (DR-A07).
 */
import type { PermissionDefinition } from './types.js';

export const ORGANISATION_PERMISSIONS = [
  { key: 'org:read', description: 'View the organisation profile and its member list.', category: 'org', operatorOnly: false },
  { key: 'org:update', description: 'Change the organisation profile.', category: 'org', operatorOnly: false },
  { key: 'org:member:invite', description: 'Invite members and list, resend or revoke invitations.', category: 'org', operatorOnly: false },
  { key: 'org:member:manage', description: 'Change the role of a member or remove a member.', category: 'org', operatorOnly: false },
  {
    key: 'org:read:any_org',
    description: 'View any organisation across tenants (operator seam).',
    category: 'org',
    operatorOnly: true,
    reserved: true,
  },
  {
    key: 'address_book:read',
    description: 'List and view address book entries of the organisation.',
    category: 'address_book',
    operatorOnly: false,
  },
  {
    key: 'address_book:manage',
    description: 'Create, update, import and delete address book entries of the organisation.',
    category: 'address_book',
    operatorOnly: false,
  },
] as const satisfies readonly PermissionDefinition[];
