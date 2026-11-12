/** Account self-service permissions: own sessions, notifications and privacy requests (REQ-RBAC-014; /me routes). */
import type { PermissionDefinition } from './types.js';

export const ACCOUNT_PERMISSIONS = [
  { key: 'session:manage', description: 'List and revoke the own sessions.', category: 'session', operatorOnly: false },
  { key: 'notification:read', description: 'View the own notification log.', category: 'notification', operatorOnly: false },
  {
    key: 'notification_pref:manage',
    description: 'View and change the own notification preferences.',
    category: 'notification',
    operatorOnly: false,
  },
  {
    key: 'privacy:export',
    description: 'Request and download an export of the own personal data.',
    category: 'privacy',
    operatorOnly: false,
  },
  {
    key: 'privacy:delete',
    description: 'Request deletion of the own account and personal data.',
    category: 'privacy',
    operatorOnly: false,
  },
] as const satisfies readonly PermissionDefinition[];
