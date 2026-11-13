/**
 * @param {{ error(message: string): void }} logger
 * @param {unknown} request
 */
export function report(logger, request) {
  logger.error(String(request));
}
