import sharp from "sharp";
import type { ImageUploadedEvent } from "./events";
import { previewKey, PREVIEW_WIDTHS } from "./keys";
import type { ImageRepo } from "./repo";
import type { Storage } from "./storage";

// Обработка одного события. Kafka доставляет at-least-once, поэтому повторное событие
// для уже готового файла просто пропускается
export async function processImage(
  event: ImageUploadedEvent,
  deps: { repo: ImageRepo; storage: Storage },
): Promise<"processed" | "skipped"> {
  const row = await deps.repo.get(event.fileId);
  if (!row || row.status === "done") return "skipped";

  await deps.repo.setStatus(event.fileId, "processing");

  try {
    const original = await deps.storage.getOriginal(event.originalKey);
    const previews: Record<string, string> = {};

    for (const width of PREVIEW_WIDTHS) {
      const body = await sharp(original)
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      const key = previewKey(event.fileId, width);
      await deps.storage.putPreview(key, body, "image/webp");
      previews[String(width)] = key;
    }

    await deps.repo.setDone(event.fileId, previews);
    return "processed";
  } catch (error) {
    // Битый файл не должен блокировать партицию: фиксируем ошибку в статусе и идём дальше
    const message = error instanceof Error ? error.message : String(error);
    await deps.repo.setStatus(event.fileId, "failed", message);
    return "processed";
  }
}
