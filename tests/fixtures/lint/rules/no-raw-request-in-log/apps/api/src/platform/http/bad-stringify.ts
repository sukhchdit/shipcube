interface Logger {
  info(fields: Record<string, unknown>, message: string): void;
}
interface Request {
  headers: Record<string, string>;
}

export const trace = (logger: Logger, req: Request): void => {
  logger.info({ headers: JSON.stringify(req.headers) }, 'incoming');
};
