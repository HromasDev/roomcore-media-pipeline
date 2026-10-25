import { z } from "zod";

// Значения по умолчанию совпадают с docker-compose.yml, поэтому без .env всё запускается локально
const schema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().default("postgres://media:media@127.0.0.1:55434/media"),

  S3_ENDPOINT: z.string().default("http://localhost:19000"),
  S3_REGION: z.string().default("us-east-1"),
  S3_ACCESS_KEY: z.string().default("minioadmin"),
  S3_SECRET_KEY: z.string().default("minioadmin"),
  S3_BUCKET_UPLOADS: z.string().default("uploads"),
  S3_BUCKET_PREVIEWS: z.string().default("previews"),
  S3_PUBLIC_URL: z.string().default("http://localhost:19000/previews"),

  KAFKA_BROKERS: z.string().default("localhost:9092"),
  KAFKA_TOPIC: z.string().default("image.uploaded"),
  KAFKA_GROUP_ID: z.string().default("media-worker"),
});

export const config = schema.parse(process.env);
export type Config = typeof config;
