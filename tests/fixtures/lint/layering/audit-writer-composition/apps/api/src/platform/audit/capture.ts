/** Stand-in for apps/api/src/platform/audit/capture.ts: the capture hook the tx slot mounts. */
export const captureAudit = (): (() => Promise<void>) => () => Promise.resolve();
