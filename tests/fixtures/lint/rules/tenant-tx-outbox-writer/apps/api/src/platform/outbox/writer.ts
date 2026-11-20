// D-ARCH-106 (ADR-0005 am. 11 item 18; TASK-043): apps/api/src/platform/outbox/writer.ts is a whole-file T-83 root
// (TENANT_TX_FILES), so a network call anywhere in it is refused, even in a function without a TenantDb parameter.
export async function notifyNow(url: string): Promise<void> {
  await fetch(url);
}
