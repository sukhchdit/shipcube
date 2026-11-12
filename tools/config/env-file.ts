/**
 * `.env`-style file checks for `.env.example` and `compose.env` (NFR-OPS-005, REQ-SEC-011, platform.md §1).
 * Findings name keys only; no value is ever copied into a result.
 */
import {
  CONFIG_KEY_NAMES,
  CONFIG_SCHEMA,
  type ConfigKey,
  isPlaceholder,
  SECRET_KEY_NAMES,
  TOOLING_CONFIG_KEYS,
  TOOLING_KEY_NAMES,
} from '@platform/config';
import { WEB_CONFIG_KEYS } from '@platform/config/web';

export interface EnvFile {
  readonly entries: ReadonlyMap<string, string>;
  /** Keys assigned more than once. */
  readonly duplicates: readonly string[];
  /** 1-based numbers of lines that are neither blank, comments nor KEY=value. */
  readonly malformedLines: readonly number[];
}

const ASSIGNMENT = /^([A-Z][A-Z0-9_]*)=(.*)$/;

/** Parses KEY=value lines; values are taken literally (no quotes, no interpolation). */
export function parseEnvFile(text: string): EnvFile {
  const entries = new Map<string, string>();
  const duplicates = new Set<string>();
  const malformedLines: number[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.trim() === '' || line.startsWith('#')) return;
    const match = ASSIGNMENT.exec(line);
    if (match === null) {
      malformedLines.push(index + 1);
      return;
    }
    const [, key = '', value = ''] = match;
    if (entries.has(key)) duplicates.add(key);
    entries.set(key, value);
  });
  return { entries, duplicates: [...duplicates].sort(), malformedLines };
}

/** Every key a process, a frontend build or a database tool reads: API/worker schema, web build schema, tooling set. */
export const ALL_CONFIG_KEYS: readonly string[] = Object.freeze(
  [...new Set<string>([...CONFIG_KEY_NAMES, ...WEB_CONFIG_KEYS, ...TOOLING_KEY_NAMES])].sort(),
);

/** Tooling keys whose value is a credential (the `_FILE` variants hold a path). */
export const TOOLING_SECRET_KEYS: readonly string[] = Object.freeze(
  TOOLING_CONFIG_KEYS.filter((key) => key.sensitivity === 'secret').map((key) => key.name),
);

const SECRET_KEYS = new Set<string>([...SECRET_KEY_NAMES, ...TOOLING_CONFIG_KEYS.map((key) => key.name)]);

/** Value shapes that are real credentials, whatever key they sit under. */
const SECRET_SHAPES: readonly RegExp[] = [
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}/,
  /\bwhsec_[A-Za-z0-9]{8,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /[A-Za-z0-9+/]{40,}={0,2}/,
  /\/\/[^/:@\s]+:[^@\s]+@/,
];

export const looksLikeSecret = (value: string): boolean => SECRET_SHAPES.some((shape) => shape.test(value));

export interface ParityReport {
  /** Schema keys absent from the file. */
  readonly missing: readonly string[];
  /** File keys the schemas do not know. */
  readonly unknown: readonly string[];
  readonly duplicates: readonly string[];
  readonly malformedLines: readonly number[];
  /** Secret keys whose example value is set but is not a placeholder. */
  readonly secretsWithoutPlaceholder: readonly string[];
  /** Non-secret keys whose example value looks like a credential. */
  readonly secretLookingValues: readonly string[];
}

/** Compares `.env.example` with the schemas: 0 undocumented keys and 0 secret-looking example values. */
export function checkEnvExampleParity(text: string): ParityReport {
  const file = parseEnvFile(text);
  const keys = [...file.entries.keys()];
  const values = [...file.entries];
  return {
    missing: ALL_CONFIG_KEYS.filter((key) => !file.entries.has(key)),
    unknown: keys.filter((key) => !ALL_CONFIG_KEYS.includes(key)).sort(),
    duplicates: file.duplicates,
    malformedLines: file.malformedLines,
    secretsWithoutPlaceholder: values
      .filter(([key, value]) => SECRET_KEYS.has(key) && value !== '' && !isPlaceholder(value))
      .map(([key]) => key)
      .sort(),
    secretLookingValues: values
      .filter(([key, value]) => !SECRET_KEYS.has(key) && looksLikeSecret(value))
      .map(([key]) => key)
      .sort(),
  };
}

/** Required secrets (no default) must show their format with a placeholder rather than an empty value. */
export function requiredSecretsLeftEmpty(text: string): readonly string[] {
  const { entries } = parseEnvFile(text);
  return SECRET_KEY_NAMES.filter((key: ConfigKey) => CONFIG_SCHEMA[key].requiredFor.length > 0 && entries.get(key) === '');
}
