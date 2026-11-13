/**
 * SPK-04 (TASK-018) THROWAWAY: every repository path the benchmark harness reads at run time, in one place, so a unit
 * test (paths.test.ts) can fail loudly when a sibling task moves or deletes one of them (code review R1-M1: the
 * runner is not executed by any CI lane, so a path that rots would otherwise stay silent until TASK-280).
 *
 * Lifecycle (D-ARCH-089, SPK-04 §8): deleted by the TASK-280 PR together with runner.ts, server.ts, verdict.ts,
 * fixtures/ and tests/load/spikes/spk04-audit.js, once the arm loop, CPU sampler, verdict and evidence writer are
 * ported to tests/load. Harness-only: nothing under apps/** or packages/** may import this file.
 */
import { join } from 'node:path';

export interface HarnessPaths {
  /** The real bootstrap lane (TASK-021): 00..02, then 10-audit.sql, then 90-audit-ddl-guard.sql, applied by runBootstrap. */
  readonly bootstrapDir: string;
  readonly bootstrapFiles: readonly string[];
  readonly migrationsDir: string;
  readonly businessFixture: string;
  readonly serverEntry: string;
  readonly k6ScriptDir: string;
  readonly k6Script: string;
  readonly postgresHarness: string;
  readonly apiRuntime: string;
}

export function harnessPaths(repoRoot: string): HarnessPaths {
  const bootstrapDir = join(repoRoot, 'prisma', 'bootstrap');
  const spikeDir = join(repoRoot, 'prisma', 'tests', 'spikes', 'spk04');
  const k6ScriptDir = join(repoRoot, 'tests', 'load', 'spikes');
  return {
    bootstrapDir,
    bootstrapFiles: ['10-audit.sql', '90-audit-ddl-guard.sql'].map((name) => join(bootstrapDir, name)),
    migrationsDir: join(repoRoot, 'prisma', 'migrations'),
    businessFixture: join(spikeDir, 'fixtures', '30-spk04-business.sql'),
    serverEntry: join(spikeDir, 'server.ts'),
    k6ScriptDir,
    k6Script: join(k6ScriptDir, 'spk04-audit.js'),
    postgresHarness: join(repoRoot, 'prisma', 'tests', 'harness', 'postgres.ts'),
    apiRuntime: join(repoRoot, 'apps', 'api', 'src', 'platform', 'db', 'runtime.ts'),
  };
}
