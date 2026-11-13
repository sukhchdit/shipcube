interface Logger {
  info(fields: Record<string, unknown>, message: string): void;
}
interface Request {
  method: string;
  headers: Record<string, string>;
}

// The request as a field (Pino serializers and redaction apply), safe values picked explicitly, and stringifying
// outside a logger call (not a log line) are fine.
export const access = (logger: Logger, req: Request): string => {
  logger.info({ req }, 'request');
  logger.info({ method: req.method }, `handled ${req.method}`);
  return JSON.stringify(req.headers);
};
