import { S3Client } from '@aws-sdk/client-s3';
import type { PutObjectCommand } from '@aws-sdk/client-s3';

interface TenantRunner {
  withTenantTx<T>(ctx: unknown, fn: (db: unknown) => Promise<T>): Promise<T>;
}

const s3 = new S3Client({});

// Member form `runner.withTenantTx(...)`.
export const upload = (runner: TenantRunner, ctx: unknown, command: PutObjectCommand): Promise<unknown> =>
  runner.withTenantTx(ctx, async () => s3.send(command));
