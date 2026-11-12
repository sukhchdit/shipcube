/**
 * Booking-context permissions: shipments, orders, customs, pickups, tracking and documents (REQ-RBAC-001/012/014).
 * `shipment:create` also guards draft edits, order assembly and `POST /shipments/{id}/tracking/refresh` (ADR-0008
 * amendment); `shipment:create:on_behalf` is the M3 seam and `shipment:read:any_org` the cross-tenant operator read
 * seam (DR-A07). Document listing is separate from obtaining or sending a file (D-051).
 */
import type { PermissionDefinition } from './types.js';

export const BOOKING_PERMISSIONS = [
  { key: 'shipment:create', description: 'Create, edit, repeat and book shipments and orders.', category: 'shipment', operatorOnly: false },
  {
    key: 'shipment:read',
    description: 'List and view shipments, their timeline and booking progress.',
    category: 'shipment',
    operatorOnly: false,
  },
  { key: 'shipment:cancel', description: 'Cancel a booked shipment.', category: 'shipment', operatorOnly: false },
  {
    key: 'shipment:create:on_behalf',
    description: 'Create a shipment on behalf of another organisation (M3 seam).',
    category: 'shipment',
    operatorOnly: false,
    reserved: true,
  },
  {
    key: 'shipment:read:any_org',
    description: 'View shipments of any organisation across tenants (operator seam).',
    category: 'shipment',
    operatorOnly: true,
    reserved: true,
  },
  { key: 'order:read', description: 'List and view orders of the organisation.', category: 'order', operatorOnly: false },
  {
    key: 'customs:manage',
    description: 'Enter, update and check the customs declaration of a shipment.',
    category: 'customs',
    operatorOnly: false,
  },
  {
    key: 'pickup:read',
    description: 'View pickup availability and the scheduled pickup of a shipment.',
    category: 'pickup',
    operatorOnly: false,
  },
  { key: 'pickup:schedule', description: 'Schedule or reschedule a pickup.', category: 'pickup', operatorOnly: false },
  { key: 'pickup:cancel', description: 'Cancel a scheduled pickup.', category: 'pickup', operatorOnly: false },
  { key: 'tracking:read', description: 'View the tracking events of a shipment.', category: 'tracking', operatorOnly: false },
  { key: 'document:read', description: 'List shipment documents and view their metadata.', category: 'document', operatorOnly: false },
  {
    key: 'document:download',
    description: 'Obtain a document file (label, customs document, invoice).',
    category: 'document',
    operatorOnly: false,
  },
  { key: 'document:email', description: 'E-mail a shipment document.', category: 'document', operatorOnly: false },
] as const satisfies readonly PermissionDefinition[];
