function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export interface StorageConfig {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  signedUrlTtlSeconds: number;
}

// First consumer of object storage in this codebase (T-G1-3) — reuses the
// MinIO env vars docker-compose.dev.yml/.env.example already defined for
// T-G0-2's dev infra (MINIO_ROOT_USER/MINIO_ROOT_PASSWORD double as the
// S3-compatible access/secret key pair, same as any MinIO deployment) rather
// than inventing new credential var names. MINIO_ENDPOINT is the one
// genuinely new var: docker-compose.dev.yml's api/worker containers reach
// MinIO via the in-network service name ("http://minio:9000"), the same
// service-name-vs-localhost split DATABASE_URL/REDIS_URL already use.
// Region is not exposed as config — MinIO ignores it, it only exists because
// the AWS SDK's S3Client requires some value.
const MINIO_REGION = 'us-east-1';

export function loadStorageConfig(): StorageConfig {
  return {
    endpoint: process.env.MINIO_ENDPOINT ?? 'http://localhost:9000',
    accessKeyId: process.env.MINIO_ROOT_USER ?? 'longrich',
    secretAccessKey: process.env.MINIO_ROOT_PASSWORD ?? 'longrich_minio_dev',
    bucket: process.env.MINIO_BUCKET ?? 'longrich-dev',
    signedUrlTtlSeconds: intEnv('STORAGE_SIGNED_URL_TTL_SECONDS', 900),
  };
}

export { MINIO_REGION };
