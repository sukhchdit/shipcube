/**
 * Test helper (PR #61 R1-M1): generated spellings of a denylist word or stem, so the property tests do not depend on a
 * hand-picked example list. Every spelling keeps the word as one word for `keyWords` (or, for a stem, contiguous in the
 * joined words), and covers snake, camel, Pascal with an acronym prefix, kebab, SCREAMING_SNAKE, a digit suffix, a
 * lower-case concatenation and a prefix word. Never imported by production code.
 */
const capital = (word: string): string => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

/** Spellings in which `word` stays a separate word (for the word list). */
export function wordSpellings(word: string): string[] {
  return [
    word,
    `new_${word}`,
    `${word}_value`,
    `new${capital(word)}`,
    `${word}Value`,
    `${word.toUpperCase()}Value`,
    `x-${word}`,
    `MY_${word.toUpperCase()}`,
    `${word}2`,
    `old-${word}-3`,
  ];
}

/** Spellings in which `stem` stays contiguous in the joined words (for the stem list). */
export function stemSpellings(stem: string): string[] {
  return [stem, `x_${stem}_y`, `old${stem}`, `${stem}Field`, `MY_${stem.toUpperCase()}`, `${stem}9`, `pre-${stem}`];
}

/**
 * The REQ-AUDIT-008 words and stems the denylist must cover, written out here INDEPENDENTLY of denylist.ts (PR #61
 * R1-M1): a property over the implementation's own list would lose the case of an entry removed from it.
 */
export const REQUIRED_SECRET_WORDS: readonly string[] = [
  'password',
  'passwords',
  'passwd',
  'passphrase',
  'passcode',
  'pwd',
  'pw',
  'pass',
  'secret',
  'secrets',
  'token',
  'tokens',
  'hash',
  'hashes',
  'hmac',
  'salt',
  'pepper',
  'otp',
  'totp',
  'csrf',
  'whsec',
  'hotp',
  'authorization',
  'authorisation',
  'auth',
  'bearer',
  'jwt',
  'jwk',
  'cookie',
  'cookies',
  'credential',
  'credentials',
  'cvv',
  'cvc',
  'csc',
  'cvn',
  'pan',
  'pin',
  'card',
  'signature',
  'proof',
  'verifier',
  'dsn',
  'sid',
  'codes',
];
export const REQUIRED_SECRET_STEMS: readonly string[] = [
  'password',
  'passwd',
  'passphrase',
  'passcode',
  'secret',
  'token',
  'credential',
  'cookie',
  'authoriz',
  'authoris',
  'bearer',
  'apikey',
  'privatekey',
  'secretkey',
  'accesskey',
  'signingkey',
  'encryptionkey',
  'manualkey',
  'recoverycode',
  'backupcode',
  'mfacode',
  'otpcode',
  'pincode',
  'mfaseed',
  'otpseed',
  'totpseed',
  'verificationcode',
  'resetcode',
  'securitycode',
  'cardnumber',
  'ccnumber',
  'creditcard',
  'paymentmethod',
  'otpauth',
  'provisioninguri',
  'reauthproof',
  'sessionid',
  'connectionstring',
  'databaseurl',
];
