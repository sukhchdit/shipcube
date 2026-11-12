/**
 * Platform-operations permissions: audit trail, feature flags and carrier health (REQ-RBAC-001/014, REQ-PLAT-021,
 * ADR-0008 amendment / A-074). All operator-only (DR-A07); `audit:export` is the M2 seam.
 */
import type { PermissionDefinition } from './types.js';

export const PLATFORM_PERMISSIONS = [
  {
    key: 'audit:read',
    description: 'Search and view audit entries, entity history and the chain status.',
    category: 'audit',
    operatorOnly: true,
  },
  { key: 'audit:export', description: 'Export audit entries (M2 seam).', category: 'audit', operatorOnly: true, reserved: true },
  { key: 'featureflag:manage', description: 'View, create and change feature flags.', category: 'featureflag', operatorOnly: true },
  {
    key: 'carrier:status:read',
    description: 'View carrier integration health and circuit-breaker status.',
    category: 'carrier',
    operatorOnly: true,
  },
] as const satisfies readonly PermissionDefinition[];
