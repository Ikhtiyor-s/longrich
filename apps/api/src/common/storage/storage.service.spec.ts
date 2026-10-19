import { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageService } from './storage.service';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));

describe('StorageService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.MINIO_ENDPOINT = 'http://minio:9000';
    process.env.MINIO_ROOT_USER = 'test-access-key';
    process.env.MINIO_ROOT_PASSWORD = 'test-secret-key';
    process.env.MINIO_BUCKET = 'test-bucket';
    process.env.STORAGE_SIGNED_URL_TTL_SECONDS = '600';
  });

  it('createPresignedUploadUrl returns a signed URL + the configured TTL without making a network call', async () => {
    (getSignedUrl as jest.Mock).mockResolvedValue('https://signed.example/test-bucket/key-1?sig=abc');

    const service = new StorageService();
    const result = await service.createPresignedUploadUrl('seller-documents/seller-1/key-1', 'application/pdf');

    expect(result).toEqual({
      url: 'https://signed.example/test-bucket/key-1?sig=abc',
      expiresInSeconds: 600,
    });
    expect(getSignedUrl).toHaveBeenCalledTimes(1);
    expect(getSignedUrl).toHaveBeenCalledWith(expect.anything(), expect.anything(), { expiresIn: 600 });
  });

  it('falls back to the documented dev defaults when MinIO env vars are unset', async () => {
    delete process.env.MINIO_ENDPOINT;
    delete process.env.MINIO_ROOT_USER;
    delete process.env.MINIO_ROOT_PASSWORD;
    delete process.env.MINIO_BUCKET;
    delete process.env.STORAGE_SIGNED_URL_TTL_SECONDS;
    (getSignedUrl as jest.Mock).mockResolvedValue('https://signed.example/fallback');

    const service = new StorageService();
    const result = await service.createPresignedUploadUrl('seller-documents/seller-1/key-2', 'image/png');

    expect(result.expiresInSeconds).toBe(900);
    expect(getSignedUrl).toHaveBeenCalledWith(expect.anything(), expect.anything(), { expiresIn: 900 });
  });

  describe('getObjectBuffer', () => {
    it('concatenates the async-iterable response Body into a single Buffer', async () => {
      const sendSpy = jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({
        Body: (async function* () {
          yield Buffer.from('hello ');
          yield Buffer.from('world');
        })(),
      } as never);

      const service = new StorageService();
      const result = await service.getObjectBuffer('catalog-imports/seller-1/file.csv');

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.toString('utf8')).toBe('hello world');
      expect(sendSpy).toHaveBeenCalledTimes(1);

      sendSpy.mockRestore();
    });

    it('returns an empty Buffer for an empty object body', async () => {
      const sendSpy = jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({
        Body: (async function* () {})(),
      } as never);

      const service = new StorageService();
      const result = await service.getObjectBuffer('catalog-imports/seller-1/empty.csv');

      expect(result.toString('utf8')).toBe('');

      sendSpy.mockRestore();
    });
  });
});
