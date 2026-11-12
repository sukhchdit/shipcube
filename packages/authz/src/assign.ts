/**
 * Role-assignment rank (REQ-ORG-010, REQ-ACCT-014, threat model AC-05, PR8-SEC-06). Customer Owner and Admin hold the
 * same permission set (D-058), so "grant only a subset of your own permissions" cannot stop an Admin from assigning
 * Owner; this explicit table does. The same table answers "may modify or remove a member holding role R". Self role
 * change and last-Owner protection are separate rules (REQ-ACCT-015, REQ-ORG-013).
 */
import { isRoleKey, type RoleKey } from './roles.js';

const OWNER_OR_ADMIN: readonly RoleKey[] = ['CUSTOMER_OWNER', 'CUSTOMER_ADMIN'];

/** Target role -> the roles that may assign it. Partner and operator roles are assignable by nobody in this run. */
export const ASSIGNABLE_BY: Readonly<Record<RoleKey, readonly RoleKey[]>> = {
  OPERATOR_SUPER_ADMIN: [],
  OPERATOR_ADMIN: [],
  OPERATOR_OPERATIONS: [],
  OPERATOR_FINANCE: [],
  OPERATOR_SUPPORT: [],
  OPERATOR_SALES: [],
  OPERATOR_COMPLIANCE_AUDITOR: [],
  OPERATOR_CONTENT_MANAGER: [],
  CUSTOMER_OWNER: ['CUSTOMER_OWNER'],
  CUSTOMER_ADMIN: OWNER_OR_ADMIN,
  CUSTOMER_SHIPPER: OWNER_OR_ADMIN,
  CUSTOMER_FINANCE: OWNER_OR_ADMIN,
  CUSTOMER_VIEWER: OWNER_OR_ADMIN,
  PARTNER_OWNER: [],
  PARTNER_DEVELOPER: [],
  PARTNER_OPERATIONS: [],
  PARTNER_FINANCE: [],
};

/**
 * Whether a member holding `assignerRoleKeys` in the target organisation (database-loaded, active membership only)
 * may assign, modify or remove `targetRoleKey`. Unknown keys fail closed.
 */
export function canAssignRole(assignerRoleKeys: readonly string[], targetRoleKey: string): boolean {
  if (!isRoleKey(targetRoleKey)) return false;
  const allowed: readonly string[] = ASSIGNABLE_BY[targetRoleKey];
  return assignerRoleKeys.some((key) => allowed.includes(key));
}
