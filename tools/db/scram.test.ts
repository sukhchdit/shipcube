/**
 * Client-side SCRAM-SHA-256 verifiers for the role passwords (PR5-SEC-01; RFC 5802, RFC 7677; TASK-003).
 */
import { createHash, createHmac } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';

import { ROLE_PASSWORD_MIN_LENGTH, ScramPasswordError, scramSha256Keys, scramSha256Verifier } from './scram.js';

const VERIFIER = /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]{24}\$[A-Za-z0-9+/=]{44}:[A-Za-z0-9+/=]{44}$/;
const strong = 'Zq7-rT9_xw2!Lm4#Vb8$Kp3%Hd6&'; // 28 printable ASCII characters, test-only

describe('SCRAM-SHA-256 verifier', () => {
  it('derives the RFC 7677 §3 test vector: the server signature and the client proof verify against the keys', () => {
    // user "user", password "pencil" (SASLprep is the identity on it), salt and nonces from RFC 7677 §3.
    const salt = Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64');
    const { storedKey, serverKey } = scramSha256Keys('pencil', salt, 4096);
    const nonce = 'rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0';
    const authMessage = ['n=user,r=rOprNGfwEbeRWgbNEkqO', `r=${nonce},s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096`, `c=biws,r=${nonce}`].join(',');
    expect(createHmac('sha256', serverKey).update(authMessage).digest('base64')).toBe('6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=');
    const proof = Buffer.from('dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=', 'base64');
    const clientSignature = createHmac('sha256', storedKey).update(authMessage).digest();
    const clientKey = Buffer.from(proof.map((byte, index) => byte ^ (clientSignature[index] as number)));
    expect(createHash('sha256').update(clientKey).digest().equals(storedKey)).toBe(true);
  });

  it("produces PostgreSQL's stored format with 4096 iterations and a fresh 16-byte salt per call", () => {
    const first = scramSha256Verifier(strong);
    const second = scramSha256Verifier(strong);
    expect(first).toMatch(VERIFIER);
    expect(second).toMatch(VERIFIER);
    expect(first).not.toBe(second);
    const salt = Buffer.alloc(16, 7);
    const fixed = scramSha256Verifier(strong, salt);
    const { storedKey, serverKey } = scramSha256Keys(strong, salt);
    expect(fixed).toBe(`SCRAM-SHA-256$4096:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`);
  });

  it('never contains the password, a quote or a backslash', () => {
    const verifier = scramSha256Verifier(strong);
    expect(verifier).not.toContain(strong);
    expect(verifier).not.toMatch(/['"\\]/);
  });

  it.each([
    ['too short', 'a'.repeat(ROLE_PASSWORD_MIN_LENGTH - 1)],
    ['non-ASCII', 'é'.repeat(ROLE_PASSWORD_MIN_LENGTH)],
    ['containing a space', `${'a'.repeat(ROLE_PASSWORD_MIN_LENGTH)} b`],
    ['containing a control character', `${'a'.repeat(ROLE_PASSWORD_MIN_LENGTH)}\n`],
    ['empty', ''],
  ])('rejects a password %s, without echoing it', (_label, password) => {
    const thrown = ((): unknown => {
      try {
        return scramSha256Verifier(password);
      } catch (error) {
        return error;
      }
    })();
    expect(thrown).toBeInstanceOf(ScramPasswordError);
    expect(password !== '' && (thrown as Error).message.includes(password)).toBe(false);
  });

  it('rejects fewer than 4096 iterations', () => {
    expect(() => scramSha256Keys(strong, Buffer.alloc(16), 1000)).toThrow(/iterations/);
  });
});
