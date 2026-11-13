import type { DemoUserProvisioner } from '../framework/contracts.js';

/**
 * Placeholder provisioner for the demo seed: reports every user as `deferred` and writes nothing. Demo users must be
 * created through the identity service so memberships, roles, audit entries and outbox events match production; that
 * service and its identity-backed {@link DemoUserProvisioner} arrive with TASK-089 and replace this constant in the
 * seed CLI. Until then the credential plan is still validated, so a refused configuration fails the seed early.
 */
export const DEFERRED_PROVISIONER: DemoUserProvisioner = Object.freeze({
  ensureUser: () => Promise.resolve('deferred' as const),
});
