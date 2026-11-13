/**
 * Contract lint (US-034 AT-US-034-01; REQ-API-001/002; ADR-0002 `openapi:lint`): Redocly with `redocly.yaml` reports no
 * errors on the contract, and its warnings are exactly the accepted set of api/README.md "Lint status".
 */
import { describe, expect, it } from '@jest/globals';

import { CONFIG, lintArgs, lintEnv, redoclyBin, runLint, SPEC } from './lint.mjs';

const LINT_TIMEOUT_MS = 120_000;

/** api/README.md "Lint status": rule -> accepted count. */
const ACCEPTED_WARNINGS: Readonly<Record<string, number>> = {
  'no-server-example.com': 1,
  'operation-4xx-response': 2,
  'no-unused-components': 5,
};

interface LintProblem {
  readonly ruleId: string;
  readonly severity: string;
}

function parseReport(stdout: string): { totals: { errors: number; warnings: number }; problems: LintProblem[] } {
  const report: unknown = JSON.parse(stdout);
  if (typeof report !== 'object' || report === null || !('totals' in report) || !('problems' in report)) {
    throw new Error('unexpected redocly JSON report shape');
  }
  return report as { totals: { errors: number; warnings: number }; problems: LintProblem[] };
}

describe('openapi:lint', () => {
  it(
    '[AT-US-034-01] the OpenAPI lint reports no errors (warnings only from the accepted set)',
    async () => {
      const { code, stdout } = await runLint({ extraArgs: ['--format=json'] });
      const { totals, problems } = parseReport(stdout);

      expect(totals.errors).toBe(0);
      expect(code).toBe(0);
      const warnings: Record<string, number> = {};
      for (const problem of problems) {
        expect(problem.severity).toBe('warn');
        warnings[problem.ruleId] = (warnings[problem.ruleId] ?? 0) + 1;
      }
      expect(warnings).toEqual(ACCEPTED_WARNINGS);
    },
    LINT_TIMEOUT_MS,
  );

  it('runs the installed CLI entry with the contract and the repository config', () => {
    const args = lintArgs(['--format=json']);
    expect(args[0]).toBe(redoclyBin());
    expect(args.slice(1)).toEqual(['lint', SPEC, '--config', CONFIG, '--format=json']);
    expect(lintArgs()).toContain('--format=stylish');
  });

  it('turns telemetry and the update notice off whatever the caller environment says', () => {
    const env = lintEnv({ REDOCLY_TELEMETRY: 'on', PATH: 'x' });
    expect(env).toMatchObject({ REDOCLY_TELEMETRY: 'off', REDOCLY_SUPPRESS_UPDATE_NOTICE: 'true', PATH: 'x' });
  });
});
