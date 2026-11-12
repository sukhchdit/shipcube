/**
 * Minimal structured process log for start-up and shutdown events, until Pino arrives with TASK-010. One JSON line
 * per event; fields are scalar and chosen by code (event names, ports, durations, error class names), never
 * configuration values, URLs or error messages (CLAUDE.md §9).
 */
export type LogFields = Readonly<Record<string, string | number | boolean>>;

export interface RuntimeLog {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export interface LogSink {
  write(line: string): unknown;
}

export function createRuntimeLog(service: string, sink: LogSink, now: () => Date = () => new Date()): RuntimeLog {
  const write = (level: 'info' | 'warn' | 'error', event: string, fields: LogFields = {}): void => {
    sink.write(`${JSON.stringify({ ...fields, level, time: now().toISOString(), service, event })}\n`);
  };
  return {
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
  };
}
