// Entry point of @platform/authz/matrix: the RBAC matrix generator, the US-071 TEST ORACLE (TASK-027). It restates the
// authenticate -> MFA gate -> authorise rules independently of the production slots, so production code never imports
// it: a production authorise that reused it would make the matrix confirm itself (PR48-SEC-03, TASK-289). The
// production entry point `@platform/authz` does not re-export it; eslint.config.mjs refuses the subpath from non-test
// files (no-restricted-imports) and any import resolving into this folder from app or package code (boundaries).
export {
  appliesTo,
  type CellOutcome,
  expectCell,
  FIXED_CALLERS,
  generateMatrix,
  type MatrixCaller,
  type MatrixCell,
  type MatrixRoute,
  type MatrixRow,
  type MatrixSource,
  matrixCallers,
  presentedKind,
  type PresentedKind,
  REFUSALS,
  type RouteMatrix,
  SIGNATURE_HEADER_NAMES,
  signatureHeaderId,
  signatureOnlyOf,
  UNPRESENTED_CREDENTIAL_HEADERS,
  verifiedId,
} from './matrix.js';
export {
  CELL_SYMBOLS,
  type CommittedMatrix,
  type CommittedRow,
  type DriftOptions,
  matrixDrift,
  NOT_APPLICABLE,
  parseRouteMatrix,
  renderRouteMatrix,
  ROUTE_MATRIX_COMMAND,
  ROUTE_MATRIX_PATH,
} from './document.js';
export { type OrgMismatchCase, orgMismatchCases, orgScopedRoutes, ORG_PATH_PARAMETER, pathParameterNames } from './org-scope.js';
