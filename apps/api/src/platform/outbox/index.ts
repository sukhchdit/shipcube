// Public surface of the transactional outbox (ADR-0004; TASK-043): module services call `outbox.publish(db, event)` in
// their handler transaction (D-ARCH-106). Re-exports only.
export {
  createOutbox,
  MAX_PAYLOAD_BYTES,
  outbox,
  OutboxWriteError,
  type Outbox,
  type OutboxDb,
  type OutboxEventInput,
  type PublishedEvent,
} from './writer.js';
