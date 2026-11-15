#!/bin/sh
# storage-init one-shot (TASK-014; platform.md §2.2 storage-init row and rustfs paragraph; D-ARCH-100 item 2): creates
# the Compose buckets with versioning enabled. Idempotent: an existing bucket is success. Waits (bounded) until RustFS
# answers. No audit-anchors bucket: the Compose anchor sink is the file: volume. Prints bucket names only.
set -eu

# The RustFS root credentials (infra/local/env/rustfs.env) become the CLI's credentials for this process only.
AWS_ACCESS_KEY_ID="$RUSTFS_ACCESS_KEY"
AWS_SECRET_ACCESS_KEY="$RUSTFS_SECRET_KEY"
unset RUSTFS_ACCESS_KEY RUSTFS_SECRET_KEY
export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
export AWS_DEFAULT_REGION=us-east-1 AWS_EC2_METADATA_DISABLED=true AWS_PAGER="" HOME=/tmp

endpoint=http://rustfs:9000
s3api() {
  aws --endpoint-url "$endpoint" --cli-connect-timeout 3 --cli-read-timeout 10 --output text s3api "$@"
}

deadline=$(( $(date +%s) + 120 ))
until s3api list-buckets >/dev/null 2>&1; do
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "[storage-init] RustFS did not answer within 120 s" >&2
    exit 1
  fi
  sleep 2
done

for bucket in documents raw-carrier-payloads exports audit-archive web-assets; do
  if s3api head-bucket --bucket "$bucket" >/dev/null 2>&1; then
    echo "[storage-init] $bucket exists"
  elif output=$(s3api create-bucket --bucket "$bucket" 2>&1); then
    echo "[storage-init] $bucket created"
  else
    case "$output" in
      *BucketAlreadyOwnedByYou*|*BucketAlreadyExists*) echo "[storage-init] $bucket exists" ;;
      *) echo "[storage-init] creating $bucket failed" >&2; exit 1 ;;
    esac
  fi
  s3api put-bucket-versioning --bucket "$bucket" --versioning-configuration Status=Enabled
done
echo "[storage-init] done"
