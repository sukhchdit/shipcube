import { S3Client } from '@aws-sdk/client-s3';

/** PR #32 M1 (D-ARCH-097 (6)): a module service reaches S3 directly instead of through the ObjectStorage port. */
export const client = (): S3Client => new S3Client({});
