export const statement = (orgId: string): string => `SELECT set_config('app.org_id', ${orgId}, true)`;
