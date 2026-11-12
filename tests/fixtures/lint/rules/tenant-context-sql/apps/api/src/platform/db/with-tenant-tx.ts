// The one runtime writer: the transaction-local setter is allowed here.
export const CONTEXT_STATEMENT = "SELECT set_config('app.org_id', $1, true), set_config('app.actor_id', $2, true)";
