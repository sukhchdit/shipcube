/**
 * PR19-SEC-01 / D-ARCH-080: the committed SYSTEM delegate list of the database platform
 * (apps/api/src/platform/db/system-models.ts, read by `TenantDb` at run time, where `tools/` is not available) equals
 * the table-class manifests' SYSTEM set mapped to Prisma delegate names, and the `platform/system-model-owner` lint
 * derives the same map. A new SYSTEM table with a Prisma model therefore fails here until it is added to the list.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { loadTableClasses } from '../db/table-classes.js';
import { loadSystemModels, parseSchemaModels } from '../eslint-rules/system-model-owner.mjs';

const REPO_ROOT = join(import.meta.dirname, '..', '..');
const SCHEMA_DIR = join(REPO_ROOT, 'prisma', 'schema');
const SYSTEM_MODELS_FILE = join(REPO_ROOT, 'apps', 'api', 'src', 'platform', 'db', 'system-models.ts');

/**
 * The committed list, read as source text (tools may not import apps/api across the workspace boundary,
 * `import-x/no-relative-packages`): the quoted names of the `SYSTEM_MODELS = [ … ] as const` literal.
 */
function committedSystemModels(): string[] {
  const literal = /export const SYSTEM_MODELS = \[([^\]]*)\] as const;/u.exec(readFileSync(SYSTEM_MODELS_FILE, 'utf8'));
  if (literal === null) throw new Error('system-models.ts no longer declares `export const SYSTEM_MODELS = [ … ] as const;`');
  return [...(literal[1] ?? '').matchAll(/'([A-Za-z][A-Za-z0-9]*)'/gu)].map((match) => match[1] ?? '');
}
const SYSTEM_MODELS = committedSystemModels();

const lowerFirst = (name: string): string => name.charAt(0).toLowerCase() + name.slice(1);

/** Every Prisma model of the schema folder with its table (`@@map`, else the model name). */
const schemaModels = (): { model: string; table: string }[] =>
  readdirSync(SCHEMA_DIR)
    .filter((file) => file.endsWith('.prisma'))
    .flatMap((file) => parseSchemaModels(readFileSync(join(SCHEMA_DIR, file), 'utf8')));

describe('SYSTEM model list (PR19-SEC-01, D-ARCH-080)', () => {
  it('[PR19-SEC-01] SYSTEM_MODELS equals the manifest SYSTEM tables that have a Prisma model, as delegate names', () => {
    const system = new Set(
      loadTableClasses()
        .filter((entry) => entry.class === 'SYSTEM')
        .map((entry) => entry.name),
    );
    expect(system.has('reference_dataset_versions')).toBe(true);
    const expected = schemaModels()
      .filter(({ table }) => system.has(table))
      .map(({ model }) => lowerFirst(model))
      .sort();
    expect([...SYSTEM_MODELS].sort()).toEqual(expected);
  });

  it('[PR19-SEC-01] the lint rule derives the same delegate -> table/module map from the repository', () => {
    const owners = new Map(loadTableClasses().map((entry) => [entry.name, entry.module]));
    const derived = loadSystemModels(REPO_ROOT);
    expect([...derived.keys()].sort()).toEqual([...SYSTEM_MODELS].sort());
    for (const [delegate, { table, module }] of derived) {
      expect({ delegate, module }).toEqual({ delegate, module: owners.get(table) });
    }
    expect(derived.get('referenceDatasetVersion')).toEqual({ table: 'reference_dataset_versions', module: 'platform' });
  });

  it('[PR19-SEC-01] the schema parser reads @@map, falls back to the model name and ignores other blocks', () => {
    const text = [
      'enum Kind {',
      '  A',
      '}',
      'model OutboxEvent {',
      '  id String @id',
      '  @@map("outbox_events")',
      '}',
      'model Plain {',
      '  id Int @id',
      '}',
    ].join('\n');
    expect(parseSchemaModels(text)).toEqual([
      { model: 'OutboxEvent', table: 'outbox_events' },
      { model: 'Plain', table: 'Plain' },
    ]);
    // Every model of the real schema parses (the parser cannot silently skip one).
    expect(schemaModels().length).toBeGreaterThanOrEqual(4);
  });
});
