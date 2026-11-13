/**
 * `GET /health/live` and `GET /health/ready` (US-012, REQ-PLAT-018; openapi.yaml `getLiveness`, `getReadiness`),
 * declared with `defineRoute` (TASK-020) and mounted by `createApp` at the root, outside `/api/v1`. Public by design
 * (anonymous, rate-limit class `none`, no database transaction) and not audited (descriptor NONE, REQ-AUDIT-006):
 * the handlers write no audit entry and the bodies hold enum statuses only (AT-US-012-05). Responses are never cached,
 * so a probe always sees the current state. Other methods and paths fall through to the app's 405/404 (US-007).
 */
import type { AuditDescriptor } from '@platform/shared';

import { defineRoute, type RouteDescriptor } from '../routing/define-route.js';
import { LIVENESS_BODY } from '../runtime/readiness.js';
import type { HealthOptions } from './types.js';

export const HEALTH_LIVE_PATH = '/health/live';
export const HEALTH_READY_PATH = '/health/ready';

const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' });

const HEALTH_AUDIT: AuditDescriptor = Object.freeze({
  action: 'NONE',
  entity: null,
  sensitivity: 'NONE',
  reasonRequired: false,
  justification: 'Health endpoint (REQ-AUDIT-006).',
});

const HEALTH_METADATA = {
  method: 'get',
  permission: 'public',
  permissionJustification: 'Load balancer and orchestrator probes.',
  audit: HEALTH_AUDIT,
  schema: {},
  rateLimit: 'none',
  idempotency: 'not-applicable',
  tenancy: 'public',
  auth: 'anonymous',
  transaction: 'none',
} as const;

export function healthRoutes(options: HealthOptions): RouteDescriptor[] {
  return [
    // Liveness has no dependency I/O: 200 while the event loop runs, also during a dependency outage (AT-US-012-02).
    defineRoute({
      ...HEALTH_METADATA,
      operationId: 'getLiveness',
      path: HEALTH_LIVE_PATH,
      handler: () => ({ status: 200, body: LIVENESS_BODY, headers: NO_STORE }),
    }),
    defineRoute({
      ...HEALTH_METADATA,
      operationId: 'getReadiness',
      path: HEALTH_READY_PATH,
      handler: async () => {
        const { httpStatus, body } = await options.probe.readiness();
        return { status: httpStatus, body, headers: NO_STORE };
      },
    }),
  ];
}
