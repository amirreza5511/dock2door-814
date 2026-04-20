import { mkdir } from 'node:fs/promises';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '@/backend/env';

const s3Client = env.storageProvider === 's3' && env.storageBucket && env.storageRegion && env.storageAccessKeyId && env.storageSecretAccessKey
  ? new S3Client({
      region: env.storageRegion,
      endpoint: env.storageEndpoint,
      credentials: {
        accessKeyId: env.storageAccessKeyId,
        secretAccessKey: env.storageSecretAccessKey,
      },
      forcePathStyle: Boolean(env.storageEndpoint),
    })
  : null;

export interface UploadTarget {
  objectKey: string;
  uploadUrl: string;
  publicUrl: string | null;
  headers: Record<string, string>;
}

export async function createPresignedUpload(objectKey: string, mimeType: string): Promise<UploadTarget> {
  if (env.storageProvider === 's3') {
    if (!s3Client || !env.storageBucket) {
      throw new Error('S3 storage is not fully configured');
    }

    const command = new PutObjectCommand({
      Bucket: env.storageBucket,
      Key: objectKey,
      ContentType: mimeType,
    });
    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });
    const publicUrl = env.storagePublicBaseUrl ? `${env.storagePublicBaseUrl.replace(/\/$/, '')}/${objectKey}` : null;
    return { objectKey, uploadUrl, publicUrl, headers: { 'Content-Type': mimeType } };
  }

  await mkdir(env.storageLocalPath, { recursive: true });
  const baseUrl = env.apiBaseUrl.replace(/\/$/, '');
  const uploadUrl = `${baseUrl}/api/trpc/uploads.localUpload?key=${encodeURIComponent(objectKey)}`;
  return { objectKey, uploadUrl, publicUrl: `${baseUrl}/uploads/${objectKey}`, headers: { 'Content-Type': mimeType } };
}
