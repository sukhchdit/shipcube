// Pickups-module error codes (DR-A26 Part B, api/README.md §11; TASK-036). Codes, statuses and titles
// equal the shared problem responses of docs/03-architecture/api/openapi.yaml; the module that implements the routes
// owns this file from then on (PLAN.md §5 rule 2). A published code is never reused for another meaning.
import type { ModuleCatalogue } from '../catalogue-entry.js';

export const pickupsCatalogue = {
  /** An active pickup exists; reschedule instead. (REQ-PICK-007) */
  PICKUP_ALREADY_SCHEDULED: { status: 409, title: 'Pickup already scheduled' },
  /** Date not served, a holiday, past cut-off or beyond the 14-day horizon. (REQ-PICK-002, EC-B25) */
  PICKUP_DATE_INVALID: { status: 422, title: 'Pickup date invalid' },
  /** Window outside carrier bounds, shorter than 120 min, or before now + lead time. (REQ-PICK-004, DR-B25) */
  PICKUP_WINDOW_INVALID: { status: 422, title: 'Pickup window invalid' },
} as const satisfies ModuleCatalogue;
