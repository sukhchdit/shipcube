/**
 * Client-side SCRAM-SHA-256 verifiers for the bootstrap lane's role passwords (PR5-SEC-01; RFC 5802, RFC 7677).
 *
 * `ALTER ROLE … PASSWORD 'SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey>'` makes PostgreSQL store the
 * verifier as is, whatever `password_encryption` says, so the plaintext never reaches the server and therefore never
 * reaches its log (`log_min_error_statement`, `log_statement = ddl`, pgaudit ROLE). The format and derivation are those
 * of PostgreSQL's `scram_build_secret` (src/common/scram-common.c) with its default of 4096 iterations.
 *
 * SASLprep (RFC 4013) is the identity on printable ASCII, so only printable ASCII passwords are accepted: the verifier
 * is then exactly what the server derives from the password at login.
 */
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';

export const SCRAM_ITERATIONS = 4096;
export const SCRAM_SALT_BYTES = 16;
/** Length floor for role passwords (the harness and the secret manager generate far longer ones). */
export const ROLE_PASSWORD_MIN_LENGTH = 24;
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;

export class ScramPasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScramPasswordError';
  }
}

export interface ScramKeys {
  storedKey: Buffer;
  serverKey: Buffer;
}

/** StoredKey and ServerKey for `password` (RFC 5802 §3). The password must be printable ASCII (SASLprep identity). */
export function scramSha256Keys(password: string, salt: Buffer, iterations: number = SCRAM_ITERATIONS): ScramKeys {
  if (!PRINTABLE_ASCII.test(password)) throw new ScramPasswordError('a role password must consist of printable ASCII characters only');
  if (!Number.isInteger(iterations) || iterations < SCRAM_ITERATIONS) {
    throw new ScramPasswordError(`SCRAM iterations must be an integer >= ${SCRAM_ITERATIONS}`);
  }
  const salted = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  return {
    storedKey: createHash('sha256').update(clientKey).digest(),
    serverKey: createHmac('sha256', salted).update('Server Key').digest(),
  };
}

/**
 * PostgreSQL SCRAM-SHA-256 verifier for a role password. Rejects passwords shorter than
 * `ROLE_PASSWORD_MIN_LENGTH` or outside printable ASCII; the message never contains the password.
 */
export function scramSha256Verifier(password: string, salt: Buffer = randomBytes(SCRAM_SALT_BYTES)): string {
  if (password.length < ROLE_PASSWORD_MIN_LENGTH) {
    throw new ScramPasswordError(`a role password must be at least ${ROLE_PASSWORD_MIN_LENGTH} characters long`);
  }
  const { storedKey, serverKey } = scramSha256Keys(password, salt);
  return `SCRAM-SHA-256$${SCRAM_ITERATIONS}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}
