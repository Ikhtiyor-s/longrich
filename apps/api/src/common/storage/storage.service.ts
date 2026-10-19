import { Injectable } from '@nestjs/common';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { loadStorageConfig, MINIO_REGION, type StorageConfig } from './storage.config';

export interface PresignedUpload {
  url: string;
  expiresInSeconds: number;
}

// ADR-001's chosen object-storage mechanism (S3/MinIO, signed URLs). This is
// the first real client wired up anywhere in apps/api — later G2+ tickets
// (product images, etc.) should inject this service rather than each module
// rolling its own S3Client. forcePathStyle is required for a self-hosted
// MinIO endpoint (virtual-hosted-style bucket addressing, the SDK's default,
// does not resolve against MinIO). getSignedUrl computes a SigV4 signature
// locally — it never calls the storage endpoint over the network, so this
// service works (and is unit/e2e-testable) even when no MinIO server is
// actually reachable from the current process.
@Injectable()
export class StorageService {
  private readonly config: StorageConfig;
  private readonly client: S3Client;

  constructor() {
    this.config = loadStorageConfig();
    this.client = new S3Client({
      endpoint: this.config.endpoint,
      region: MINIO_REGION,
      forcePathStyle: true,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
    });
  }

  async createPresignedUploadUrl(objectKey: string, contentType: string): Promise<PresignedUpload> {
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: objectKey,
      ContentType: contentType,
    });
    const expiresInSeconds = this.config.signedUrlTtlSeconds;
    const url = await getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
    return { url, expiresInSeconds };
  }

  // First real consumer that reads object content back (every upload flow
  // before T-G2-8 only ever issues a presigned PUT and never fetches the
  // bytes server-side — e.g. MockMalwareScanAdapter never reads objectKey).
  // The CSV import validate job genuinely needs the uploaded file's content
  // to parse rows, so this is the first GetObjectCommand call site.
  async getObjectBuffer(objectKey: string): Promise<Buffer> {
    const command = new GetObjectCommand({ Bucket: this.config.bucket, Key: objectKey });
    const response = await this.client.send(command);
    const chunks: Buffer[] = [];
    const body = response.Body as AsyncIterable<Uint8Array>;
    for await (const chunk of body) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}
