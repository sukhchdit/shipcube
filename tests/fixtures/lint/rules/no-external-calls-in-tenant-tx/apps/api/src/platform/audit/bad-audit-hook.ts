interface Deps {
  queue: { add(name: string, data: unknown): Promise<unknown> };
}

// D-ARCH-106 R5: every function of a txFiles file (the audit hook) runs inside the business transaction.
export function auditHook(deps: Deps, entry: object): Promise<unknown> {
  return deps.queue.add('audit', entry);
}
