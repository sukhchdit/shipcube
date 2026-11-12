/**
 * Structured configuration errors (REQ-PLAT-004, NFR-OPS-005, EC-A40). An issue carries the key NAME, a fixed
 * reason code and, for schema failures, the validator rule identifier (for example `number.min`). No issue,
 * message or formatted line ever contains a configured value.
 */
export type ConfigIssueCode =
  /** A required key is absent or empty (also used when a companion key is required by another key's value). */
  | 'missing'
  /** The value does not match the key's type, format or range. */
  | 'invalid'
  /** The value is a documented placeholder or a `local-only-*` value in staging or production (SEC-P3-08 item 5). */
  | 'placeholder'
  /** Two key variables hold the same key material (one key per purpose, SEC-TC-49). */
  | 'duplicate-key-material'
  /** Plain-text transport outside `APP_ENV ∈ {local, test}` (NFR-SEC-007). */
  | 'insecure-transport'
  /** A debug or inspector flag outside `APP_ENV=local` (SEC-P3-08 item 6, R-22). */
  | 'debug-flag'
  /** The key or value is not allowed in this environment (Mock carrier or gateway in production). */
  | 'forbidden-in-environment'
  /** Values that contradict each other (TTL ordering, rotation key ids). */
  | 'inconsistent'
  /** A live-mode payment key (PAYMENT_LIVE_KEY_FORBIDDEN, ADR-0018 §3). */
  | 'live-key-forbidden'
  /** A secret reference could not be resolved by its provider. */
  | 'unresolvable';

export interface ConfigIssue {
  readonly key: string;
  readonly code: ConfigIssueCode;
  /** Validator rule identifier (no value): a schema rule, or the failure class of a secret reference (`ref.timeout`). */
  readonly rule?: string;
  /**
   * Value-free cause of a secret provider failure: the error class name and, when present, an errno-style code
   * (`TypeError`, `SecretFileError/EACCES`, `non-error:string`). Never a message, locator or value.
   */
  readonly cause?: string;
}

const compareIssues = (a: ConfigIssue, b: ConfigIssue): number =>
  a.key.localeCompare(b.key) ||
  a.code.localeCompare(b.code) ||
  (a.rule ?? '').localeCompare(b.rule ?? '') ||
  (a.cause ?? '').localeCompare(b.cause ?? '');

const issueId = (issue: ConfigIssue): string => `${issue.key}\u0000${issue.code}\u0000${issue.rule ?? ''}\u0000${issue.cause ?? ''}`;

/** Sorted, de-duplicated copy of `issues`. */
export function normaliseIssues(issues: readonly ConfigIssue[]): readonly ConfigIssue[] {
  const unique = new Map<string, ConfigIssue>();
  for (const issue of issues) unique.set(issueId(issue), Object.freeze({ ...issue }));
  return Object.freeze([...unique.values()].sort(compareIssues));
}

const describe = (issue: ConfigIssue): string => {
  const rule = issue.rule === undefined ? issue.code : `${issue.code}: ${issue.rule}`;
  return issue.cause === undefined ? rule : `${rule} (${issue.cause})`;
};

/**
 * Thrown when configuration is rejected. `keys` lists every offending key name once; `issues` gives the reason
 * per key. The message is built from names and codes only.
 */
export class ConfigValidationError extends Error {
  override readonly name = 'ConfigValidationError';
  readonly issues: readonly ConfigIssue[];
  readonly keys: readonly string[];

  constructor(issues: readonly ConfigIssue[]) {
    const normalised = normaliseIssues(issues);
    const keys = Object.freeze([...new Set(normalised.map((issue) => issue.key))]);
    super(`Configuration rejected for ${keys.length} key(s): ${normalised.map((i) => `${i.key} (${describe(i)})`).join(', ')}`);
    this.issues = normalised;
    this.keys = keys;
  }

  /** Names of keys reported as missing. */
  get missingKeys(): readonly string[] {
    return this.issues.filter((issue) => issue.code === 'missing').map((issue) => issue.key);
  }
}

/** Multi-line report for stderr at start-up: one line per issue, names and codes only. */
export function formatConfigError(error: ConfigValidationError): string {
  const lines = error.issues.map((issue) => `  - ${issue.key}: ${describe(issue)}`);
  return [`Configuration invalid; refusing to start (${error.keys.length} key(s)):`, ...lines].join('\n');
}
