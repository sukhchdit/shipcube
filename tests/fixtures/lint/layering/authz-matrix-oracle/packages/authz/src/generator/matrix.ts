// Stand-in for the RBAC matrix oracle (PR48-SEC-03): an import target that gives its importers' dependency the
// authz-matrix-oracle category.
export const expectCell = (): string => 'allow';
