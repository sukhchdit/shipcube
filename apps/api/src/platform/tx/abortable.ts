/**
 * Deadline enforcement for the route phases that run outside a transaction (PR #44 R1-M1, PR44-SEC-02, D-ORCH-069):
 * a signal only asks work to stop, so the tx slot and the afterCommit queue also stop WAITING for it when the signal
 * aborts. Work that ignores the signal is abandoned (its later outcome is ignored), never awaited past its deadline.
 */

/**
 * Settles like `work`, or rejects with `signal.reason` as soon as `signal` aborts (at once when it already has). A later
 * rejection of abandoned work is consumed here, so it never becomes an unhandled rejection.
 */
export function abortable<T>(work: PromiseLike<T> | T, signal: AbortSignal): Promise<T> {
  const settled = Promise.resolve(work);
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(signal.reason as Error);
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    settled
      .finally(() => {
        signal.removeEventListener('abort', onAbort);
      })
      .then(resolve, reject);
  });
}

/** An AbortController aborted with `reason()` after `ms`; the timer never keeps the process alive and `clear` stops it. */
export function deadline(ms: number, reason: () => unknown): { readonly signal: AbortSignal; readonly clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(reason()), ms);
  timer.unref();
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}
