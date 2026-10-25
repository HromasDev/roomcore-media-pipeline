import { Hono } from "hono";
import { z } from "zod";
import type { ImageUploadedEvent } from "./events";
import { isAllowedContentType, originalKey } from "./keys";
import type { ImageRepo } from "./repo";
import type { Storage } from "./storage";
import { previewKey, PREVIEW_WIDTHS } from "./keys";

const UPLOAD_URL_TTL_SECONDS = 300;

export interface AppDeps {
  repo: ImageRepo;
  storage: Storage;
  publish: (event: ImageUploadedEvent) => Promise<void>;
  previewBaseUrl: string;
}

const createUploadSchema = z.object({
  contentType: z.string(),
});

export function createApp(deps: AppDeps) {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  // Шаг 1: клиент просит ссылку для загрузки и получает временный presigned URL
  app.post("/uploads", async (c) => {
    const body = createUploadSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success || !isAllowedContentType(body.data.contentType)) {
      return c.json({ error: "contentType должен быть image/jpeg, image/png или image/webp" }, 400);
    }

    const fileId = crypto.randomUUID();
    const key = originalKey(fileId, body.data.contentType);
    await deps.repo.create({ id: fileId, originalKey: key, contentType: body.data.contentType });
    const uploadUrl = await deps.storage.presignUpload(key, body.data.contentType, UPLOAD_URL_TTL_SECONDS);

    return c.json({ fileId, uploadUrl, expiresIn: UPLOAD_URL_TTL_SECONDS }, 201);
  });

  // Шаг 2: после прямой загрузки в S3 клиент сообщает «готово», бэкенд отдаёт работу воркеру через Kafka
  app.post("/uploads/:id/complete", async (c) => {
    const id = c.req.param("id");
    const row = await deps.repo.get(id);
    if (!row) return c.json({ error: "not found" }, 404);
    if (row.status !== "pending") return c.json({ error: `уже в статусе ${row.status}` }, 409);
    if (!(await deps.storage.originalExists(row.originalKey))) {
      return c.json({ error: "файл ещё не загружен в хранилище" }, 400);
    }

    await deps.repo.setStatus(id, "queued");
    await deps.publish({ fileId: id, originalKey: row.originalKey });

    return c.json({ status: "queued" }, 202);
  });

  app.get("/images/:id", async (c) => {
    const row = await deps.repo.get(c.req.param("id"));
    if (!row) return c.json({ error: "not found" }, 404);

    const previews =
      row.status === "done"
        ? Object.fromEntries(
            PREVIEW_WIDTHS.map((width) => [width, `${deps.previewBaseUrl}/${previewKey(row.id, width)}`]),
          )
        : null;

    return c.json({ id: row.id, status: row.status, error: row.error, previews });
  });

  return app;
}
