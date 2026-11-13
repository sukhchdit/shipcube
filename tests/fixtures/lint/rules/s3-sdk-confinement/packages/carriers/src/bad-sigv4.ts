import { SignatureV4 } from '@smithy/signature-v4';

/** PR #32 M1 (PR30-SEC-08 (e)): a package signs requests with the raw SigV4 signer outside the S3 seam. */
export const signer = (): typeof SignatureV4 => SignatureV4;
