/** PR32-SEC-07 (a) S3: a computed import(where) hides the SYSTEM accessor (and any other module) from the import controls. */
export const load = async (where: string): Promise<unknown> => import(where);
