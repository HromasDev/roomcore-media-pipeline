import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Config } from "./config";

function createClient(config: Config): S3Client {
  // forcePathStyle нужен для MinIO: адрес вида http://host:9000/bucket/key
  return new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY,
      secretAccessKey: config.S3_SECRET_KEY,
    },
  });
}

// Создаёт бакеты, если их нет: uploads остаётся приватным, previews открыт на чтение
export async function ensureBuckets(config: Config): Promise<void> {
  const client = createClient(config);
  for (const bucket of [config.S3_BUCKET_UPLOADS, config.S3_BUCKET_PREVIEWS]) {
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
    }
  }
  const publicRead = {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: "*",
        Action: ["s3:GetObject"],
        Resource: [`arn:aws:s3:::${config.S3_BUCKET_PREVIEWS}/*`],
      },
    ],
  };
  await client.send(
    new PutBucketPolicyCommand({ Bucket: config.S3_BUCKET_PREVIEWS, Policy: JSON.stringify(publicRead) }),
  );
}

export interface Storage {
  presignUpload(key: string, contentType: string, expiresIn: number): Promise<string>;
  originalExists(key: string): Promise<boolean>;
  getOriginal(key: string): Promise<Buffer>;
  putPreview(key: string, body: Buffer, contentType: string): Promise<void>;
}

export function createStorage(config: Config): Storage {
  const client = createClient(config);

  return {
    // Клиент грузит файл прямо в S3 по временной ссылке, бэкенд файл не проксирует
    presignUpload(key, contentType, expiresIn) {
      const command = new PutObjectCommand({
        Bucket: config.S3_BUCKET_UPLOADS,
        Key: key,
        ContentType: contentType,
      });
      return getSignedUrl(client, command, { expiresIn });
    },

    async originalExists(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: config.S3_BUCKET_UPLOADS, Key: key }));
        return true;
      } catch (error) {
        const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 404) return false;
        throw error;
      }
    },

    async getOriginal(key) {
      const response = await client.send(
        new GetObjectCommand({ Bucket: config.S3_BUCKET_UPLOADS, Key: key }),
      );
      if (!response.Body) throw new Error(`empty body for ${key}`);
      return Buffer.from(await response.Body.transformToByteArray());
    },

    async putPreview(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: config.S3_BUCKET_PREVIEWS,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    },
  };
}
