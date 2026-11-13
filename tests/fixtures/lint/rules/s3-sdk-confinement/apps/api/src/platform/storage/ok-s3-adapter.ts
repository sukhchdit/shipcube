import { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** PR #32 M1 positive control: the S3 seam (apps/api/src/platform/storage) imports the AWS SDK. */
export const adapter = (): readonly unknown[] => [new S3Client({}), getSignedUrl];
