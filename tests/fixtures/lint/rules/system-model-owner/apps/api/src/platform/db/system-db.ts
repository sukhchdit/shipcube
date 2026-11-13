import { systemGuard } from './system-port.js';

/** PR32-SEC-07 (b) positive control: the accessor's home is exempt (it imports the private system-port). */
export const systemDelegates = (tx: object): object => systemGuard(tx);
