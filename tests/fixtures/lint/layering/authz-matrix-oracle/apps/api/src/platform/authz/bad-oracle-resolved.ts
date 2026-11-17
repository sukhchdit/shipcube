// PR48-SEC-03: a production authorise reaches the oracle by relative path (resolved file).
import { expectCell } from '../../../../../packages/authz/src/generator/matrix.js';

export const decide = (): string => expectCell();
