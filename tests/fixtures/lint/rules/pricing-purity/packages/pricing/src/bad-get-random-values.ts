export const salt = (): Uint8Array => globalThis.crypto.getRandomValues(new Uint8Array(4));
