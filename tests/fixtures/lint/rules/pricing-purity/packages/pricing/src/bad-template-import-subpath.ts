// PR080-SEC-03 (TASK-080): an expression-free template literal is a static specifier; the subpath carries retryDelayMs,
// whose default random source is Math.random.
export const backoff = async (): Promise<number> => (await import(`@platform/shared/queues`)).retryDelayMs(1);
