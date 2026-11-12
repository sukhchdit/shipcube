// R2-m2: a SET of a quoted tenant-context key (`"app"."org_id"`) re-scopes the rest of the transaction.
export const statement = `SET "app"."org_id" = '00000000-0000-0000-0000-000000000000'`;
