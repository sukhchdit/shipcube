// The negative control: the only file allowed the session-scoped form.
export const leak = "SELECT set_config('app.org_id', $1, false)";
export const reset = 'RESET app.org_id';
