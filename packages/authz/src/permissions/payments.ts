/**
 * Payments-context permissions (REQ-RBAC-001/014): checkout, payments, saved payment methods, the M2 refund approval
 * seam (ADR-0008 §3) and the signature-authenticated gateway webhooks (ADR-0008 amendment). The webhook caller is
 * the payment gateway, not a user, so no role holds a webhook permission; `webhook:mock_gateway:receive` is mounted
 * in non-production environments only.
 */
import type { PermissionDefinition } from './types.js';

export const PAYMENTS_PERMISSIONS = [
  { key: 'payment:create', description: 'Start checkout and confirm a payment for an order.', category: 'payment', operatorOnly: false },
  { key: 'payment:read', description: 'View payments of the organisation.', category: 'payment', operatorOnly: false },
  {
    key: 'payment_method:manage',
    description: 'View, add, change and remove the own saved payment methods.',
    category: 'payment',
    operatorOnly: false,
  },
  { key: 'refund:approve', description: 'Approve a refund (M2 seam).', category: 'refund', operatorOnly: false, reserved: true },
  {
    key: 'webhook:stripe:receive',
    description: 'Receive a signed Stripe webhook event.',
    category: 'webhook',
    operatorOnly: false,
    signatureOnly: true,
  },
  {
    key: 'webhook:mock_gateway:receive',
    description: 'Receive a signed mock payment-gateway webhook event (non-production).',
    category: 'webhook',
    operatorOnly: false,
    signatureOnly: true,
  },
] as const satisfies readonly PermissionDefinition[];
