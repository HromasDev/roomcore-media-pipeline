import { z } from "zod";

// В Kafka уходит только лёгкое событие со ссылкой на объект в S3, сам файл в шину не кладём
export const imageUploadedSchema = z.object({
  fileId: z.string().uuid(),
  originalKey: z.string().min(1),
});

export type ImageUploadedEvent = z.infer<typeof imageUploadedSchema>;
