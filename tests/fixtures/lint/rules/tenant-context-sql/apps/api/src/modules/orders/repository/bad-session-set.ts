// AT-US-075-03: a session-level SET of a tenant-context key in source fails lint.
export const statement = 'SET app.org_id = $1';
