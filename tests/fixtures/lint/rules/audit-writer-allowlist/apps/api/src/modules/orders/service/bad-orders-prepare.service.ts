import { prepareEntry } from '@platform/audit';

// PR42-SEC-06: the entry assembler is the writer's first half; feature code goes through the route audit middleware.
export const prepare: unknown = prepareEntry;
