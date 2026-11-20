// Event type sequencing (ADR-0004 amendment 2 item 12; D-ARCH-184 F10; TASK-043): the relay enqueues every event on
// `outbox-relay`, and only the processor of that queue (the dispatcher, TASK-047) consumes it. An event type catalogued
// before that processor is registered would pile its jobs up in Valkey and be acted on late, so this test fails as soon
// as `EVENT_CATALOGUE` holds a type while `PROCESSORS['outbox-relay']` is missing.
import { describe, expect, it } from '@jest/globals';
import { EVENT_CATALOGUE } from '@platform/shared/events';

import { PROCESSORS } from './processors.js';

describe('[ADR-0004 am. 2 item 12] event types and the outbox-relay processor (D-ARCH-184)', () => {
  it('[ADR-0004 am. 2 item 12] no event type is catalogued before outbox-relay has its processor', () => {
    const types = Object.keys(EVENT_CATALOGUE);
    const registered = PROCESSORS['outbox-relay'] !== undefined;
    expect({ types: types.length > 0, registered: registered || types.length === 0 }).toEqual({
      types: types.length > 0,
      registered: true,
    });
  });
});
