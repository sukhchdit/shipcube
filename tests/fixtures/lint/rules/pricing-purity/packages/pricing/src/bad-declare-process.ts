// Code review R1-m3 (TASK-080): every watched global is pinned, not only Date. A declared process hides process.env from
// the global-scope pass; at run time it is still the real environment.
declare const process: { readonly env: Record<string, string | undefined> };

export const region = (): string | undefined => process.env['REGION'];
