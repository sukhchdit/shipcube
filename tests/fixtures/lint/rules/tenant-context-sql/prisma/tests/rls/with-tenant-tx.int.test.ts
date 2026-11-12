// Tokens are allowed here, the session-scoped setter is not.
export const leak = "SELECT set_config('app.org_id', $1, false)";
