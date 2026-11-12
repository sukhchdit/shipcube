// Public entry point of @platform/authz: permission catalogue, role seed, build-time guards, the authorisation
// decision and the generators of the role-permission matrix document and the seed migration (ADR-0008).
export {
  isOperatorOnlyKey,
  isPermission,
  isReadPermission,
  isRouteMarker,
  OPERATOR_ONLY_PERMISSIONS,
  PERMISSION_CATEGORIES,
  PERMISSION_DEFINITIONS,
  PERMISSION_KEY_FORMAT,
  PERMISSIONS,
  permissionVerb,
  READ_ONLY_VERBS,
  ROUTE_MARKERS,
  SCOPE_QUALIFIERS,
  type Permission,
  type PermissionCategory,
  type PermissionDefinition,
  type RouteMarker,
} from './permissions/index.js';
export {
  ASSIGNABLE_CUSTOMER_ROLES,
  CATALOGUE_VERSION,
  COMPLIANCE_AUDITOR_ROLE,
  CUSTOMER_VIEWER_ROLE,
  ROLE_KEYS,
  ROLE_SCOPES,
  ROLES,
  SUPER_ADMIN_ROLE,
  type RoleDefinition,
  type RoleKey,
  type RoleScope,
} from './roles.js';
export {
  checkCatalogue,
  checkRoleInvariants,
  EXPECTED_ROLE_COUNTS,
  IMPLIED_GRANTS,
  VIEWER_FORBIDDEN,
  type Violation,
  type ViolationCode,
} from './guard.js';
export { authorise, effectivePermissions, UnknownRoleError, type AuthzDecision } from './authorise.js';
export { assertRoutePermissions, findUnknownRoutePermissions, UnknownRoutePermissionError, type DeclaredRoute } from './routes.js';
export { AUTHZ_GENERATE_COMMAND, MATRIX_DOC_PATH, renderRolePermissionMatrix } from './matrix-doc.js';
export { linkKey, renderSeedMigration, SYSTEM_ACTOR_ID, type SeedIdFactory, type SeedIdKind, type SeedMigration } from './seed-sql.js';
