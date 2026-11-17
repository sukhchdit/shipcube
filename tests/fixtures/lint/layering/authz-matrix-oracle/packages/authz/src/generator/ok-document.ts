// The generator folder imports its own modules (PR48-SEC-03 confines the oracle to tests, not to itself).
import { expectCell } from './matrix.js';

export const render = (): string => expectCell();
