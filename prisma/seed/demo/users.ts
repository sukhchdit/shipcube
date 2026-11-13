import type { DemoUserSpec } from '../framework/contracts.js';

const staff = (localPart: string): DemoUserSpec => ({
  email: `${localPart}@operator.example`,
  kind: 'staff',
  passwordVariable: 'SEED_SUPERADMIN_PASSWORD',
});

const acme = (localPart: string): DemoUserSpec => ({
  email: `${localPart}@acme-exports.example`,
  kind: 'customer',
  passwordVariable: 'SEED_CUSTOMER_PASSWORD',
});

/**
 * The demo users of data-model §9.3: the eight operator staff roles, the five customer roles of the Acme Exports
 * business account, and one registered individual. Addresses use reserved `.example` domains. Role assignment is the
 * identity service's job (TASK-089); the seed only names who must exist and which `SEED_*` variable seeds the password.
 */
export const DEMO_USERS: readonly DemoUserSpec[] = Object.freeze([
  staff('superadmin'),
  staff('admin'),
  staff('operations'),
  staff('finance'),
  staff('support'),
  staff('sales'),
  staff('auditor'),
  staff('content'),
  acme('owner'),
  acme('admin'),
  acme('shipper'),
  acme('finance'),
  acme('viewer'),
  { email: 'individual@customer.example', kind: 'customer', passwordVariable: 'SEED_CUSTOMER_PASSWORD' },
]);
