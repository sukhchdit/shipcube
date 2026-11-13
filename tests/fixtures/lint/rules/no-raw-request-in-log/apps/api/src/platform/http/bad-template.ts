interface Request {
  log: { warn(message: string): void };
  rawHeaders: string[];
}

export const warnRaw = (req: Request): void => {
  req.log.warn(`unexpected headers ${req.rawHeaders}`);
};
