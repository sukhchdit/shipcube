import type { DemoCredential, DemoCredentialPlan, DemoSeedOptions, DemoUserOutcome, DemoUserSpec } from '../framework/contracts.js';

export interface DemoSeedSummary {
  readonly created: number;
  readonly unchanged: number;
  readonly deferred: number;
  readonly skipped: boolean;
}

function credentialFor(spec: DemoUserSpec, plan: Exclude<DemoCredentialPlan, { kind: 'skip' }>): DemoCredential {
  if (plan.kind === 'set-password-link') return { kind: 'set-password-link' };
  const password = plan.passwords.get(spec.passwordVariable);
  if (password === undefined) {
    // The plan validated every variable, so a gap is a programming error. Name the variable, never a value.
    throw new Error(`Demo credential plan has no password for ${spec.passwordVariable}`);
  }
  return { kind: 'password', password };
}

/**
 * Applies a {@link DemoCredentialPlan}: ensures each demo user through the provisioner, one at a time (identity writes
 * are transactional per user). `skip` makes no provisioner call. Logs one `demo.user` event per user (synthetic
 * `.example` address and outcome) and a summary; it never logs or returns a password.
 */
export async function runDemoSeed(options: DemoSeedOptions, plan: DemoCredentialPlan): Promise<DemoSeedSummary> {
  const { appEnv, users, provisioner, logger } = options;
  if (plan.kind === 'skip') {
    logger.info('demo.skipped', { reason: plan.reason });
    return { created: 0, unchanged: 0, deferred: 0, skipped: true };
  }

  const counts: Record<DemoUserOutcome, number> = { created: 0, unchanged: 0, deferred: 0 };
  for (const spec of users) {
    const outcome = await provisioner.ensureUser(spec, credentialFor(spec, plan));
    counts[outcome] += 1;
    logger.info('demo.user', { email: spec.email, outcome });
  }
  logger.info('demo.completed', { appEnv, credential: plan.kind, users: users.length, ...counts });
  return { ...counts, skipped: false };
}
