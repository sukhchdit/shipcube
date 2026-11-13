interface Log {
  error(fields: Record<string, unknown>, message: string): void;
}

export function guarded(log: Log, task: () => void): void {
  try {
    task();
  } catch (err) {
    // Structured field: the logger serializer and redaction handle it.
    log.error({ err }, 'task failed');
    const message = 'fixed text';
    log.error({ code: 'TASK_FAILED' }, `${message} (no error text)`);
    throw err;
  }
}
