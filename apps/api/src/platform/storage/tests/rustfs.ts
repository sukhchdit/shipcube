/**
 * RustFS test container shared by the storage contract suite and the readiness suite (SPK-05). Test support only: never
 * imported by production code (it lives in `tests/`, outside coverage). Credentials are generated per run.
 *
 * Image: RustFS 1.0.4 (tag published 2026-10-25, outside the 7-day cooldown; 1.0.5 of 2026-11-10 was too new),
 * pinned by the multi-arch index digest that `docker pull rustfs/rustfs:1.0.4` reports (2026-11-13). The image
 * reads `RUSTFS_ACCESS_KEY` / `RUSTFS_SECRET_KEY`, serves the S3 API on 9000 (console on 9001) and stores under /data.
 */
import { randomBytes } from 'node:crypto';

import { CreateBucketCommand, PutBucketVersioningCommand, S3Client } from '@aws-sdk/client-s3';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

export const RUSTFS_IMAGE = 'rustfs/rustfs:1.0.4@sha256:ed9210d6411d77ffceb70d94b964a3cb7d225983368bc25bebe01e995293dcc2';
export const RUSTFS_STARTUP_TIMEOUT_MS = 180_000;

export interface RunningRustfs {
  readonly container: StartedTestContainer;
  readonly host: string;
  readonly port: number;
  readonly endpoint: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Creates a bucket (optionally with versioning enabled) through a raw SDK client. */
  createBucket(name: string, options?: { readonly versioned?: boolean }): Promise<void>;
  stop(): Promise<void>;
}

export async function startRustfs(): Promise<RunningRustfs> {
  const accessKeyId = `ak${randomBytes(8).toString('hex')}`;
  const secretAccessKey = randomBytes(24).toString('hex');
  const container = await new GenericContainer(RUSTFS_IMAGE)
    .withEnvironment({ RUSTFS_ACCESS_KEY: accessKeyId, RUSTFS_SECRET_KEY: secretAccessKey })
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp('/health', 9000).forStatusCode(200))
    .withStartupTimeout(RUSTFS_STARTUP_TIMEOUT_MS)
    .start();
  const host = container.getHost();
  const port = container.getMappedPort(9000);
  const endpoint = `http://${host}:${String(port)}`;
  const admin = new S3Client({ endpoint, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId, secretAccessKey } });
  return {
    container,
    host,
    port,
    endpoint,
    accessKeyId,
    secretAccessKey,
    async createBucket(name, options) {
      await admin.send(new CreateBucketCommand({ Bucket: name }));
      if (options?.versioned === true) {
        await admin.send(new PutBucketVersioningCommand({ Bucket: name, VersioningConfiguration: { Status: 'Enabled' } }));
      }
    },
    async stop() {
      admin.destroy();
      await container.stop().catch(() => undefined);
    },
  };
}
