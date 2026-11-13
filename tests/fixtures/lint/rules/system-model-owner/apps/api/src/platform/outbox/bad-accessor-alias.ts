import { systemDelegates } from '../db/system-db.js';

/** PR19-SEC-01: the accessor's result kept in a variable hides which SYSTEM model is reached, even in the owner. */
export const delegates = (tx: object): object => {
  const all = systemDelegates(tx);
  return all;
};
