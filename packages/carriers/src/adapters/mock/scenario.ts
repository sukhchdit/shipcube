/**
 * The latency hook of the Mock scenario directives (DR-B29, ADR-0005 am. 11 item 21 / D-ARCH-106). Only `latency` is
 * read here: it is the instrument of the runtime twin of the T-83 lint (a route that keeps a transaction open across a
 * carrier call fails under `DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS=1000`). The rest of the vocabulary (`fail`, `error`,
 * `rates=empty`, `track=...`), the `MOCK:` customer-reference source and the production exclusion are TASK-097's.
 * The caller decides whether directives are honoured (`MOCK_SCENARIOS_ENABLED`); a disabled Mock ignores them.
 */

/** `latency=<0..30000 ms>` (DR-B29). */
export const MAX_LATENCY_MS = 30_000;
const LATENCY = /^latency=(\d{1,5})$/u;

/** The delay a raw directive string asks for, in ms; 0 when absent, malformed or beyond the DR-B29 range. */
export function parseLatencyMs(raw: string | undefined): number {
  if (raw === undefined) return 0;
  for (const directive of raw.split(';')) {
    const match = LATENCY.exec(directive.trim());
    if (match?.[1] !== undefined) {
      const value = Number(match[1]);
      return value <= MAX_LATENCY_MS ? value : 0;
    }
  }
  return 0;
}
