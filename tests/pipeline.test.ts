import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { createApp } from "../src/app";
import type { ImageUploadedEvent } from "../src/events";
import { isAllowedContentType, originalKey, previewKey } from "../src/keys";
import { processImage } from "../src/process-image";
import type { ImageRepo, ImageRow, ImageStatus } from "../src/repo";
import type { Storage } from "../src/storage";

function fakeRepo(): ImageRepo & { rows: Map<string, ImageRow> } {
  const rows = new Map<string, ImageRow>();
  return {
    rows,
    async create({ id, originalKey, contentType }) {
      rows.set(id, { id, originalKey, contentType, status: "pending", previews: null, error: null });
    },
    async get(id) {
      return rows.get(id) ?? null;
    },
    async setStatus(id, status: ImageStatus, error) {
      const row = rows.get(id);
      if (row) Object.assign(row, { status, error: error ?? null });
    },
    async setDone(id, previews) {
      const row = rows.get(id);
      if (row) Object.assign(row, { status: "done", previews, error: null });
    },
  };
}

function fakeStorage(original?: Buffer): Storage & { previews: Map<string, Buffer> } {
  const previews = new Map<string, Buffer>();
  return {
    previews,
    async presignUpload(key) {
      return `http://s3.test/uploads/${key}?signed=1`;
    },
    async originalExists() {
      return original !== undefined;
    },
    async getOriginal() {
      if (!original) throw new Error("no original");
      return original;
    },
    async putPreview(key, body) {
      previews.set(key, body);
    },
  };
}

describe("keys", () => {
  test("имя файла от клиента в ключ не попадает", () => {
    expect(originalKey("abc", "image/png")).toBe("abc/original.png");
    expect(previewKey("abc", 320)).toBe("abc/320.webp");
  });

  test("разрешены только изображения", () => {
    expect(isAllowedContentType("image/jpeg")).toBe(true);
    expect(isAllowedContentType("application/pdf")).toBe(false);
  });
});

describe("api", () => {
  test("полный цикл: ссылка, complete, событие в Kafka", async () => {
    const repo = fakeRepo();
    const events: ImageUploadedEvent[] = [];
    const app = createApp({
      repo,
      storage: fakeStorage(Buffer.from("x")),
      publish: async (event) => void events.push(event),
      previewBaseUrl: "http://cdn.test",
    });

    const created = await app.request("/uploads", {
      method: "POST",
      body: JSON.stringify({ contentType: "image/png" }),
    });
    expect(created.status).toBe(201);
    const { fileId, uploadUrl } = (await created.json()) as { fileId: string; uploadUrl: string };
    expect(uploadUrl).toContain(fileId);

    const completed = await app.request(`/uploads/${fileId}/complete`, { method: "POST" });
    expect(completed.status).toBe(202);
    expect(events).toEqual([{ fileId, originalKey: `${fileId}/original.png` }]);
    expect(repo.rows.get(fileId)?.status).toBe("queued");

    const again = await app.request(`/uploads/${fileId}/complete`, { method: "POST" });
    expect(again.status).toBe(409);
  });

  test("не принимает не изображения", async () => {
    const app = createApp({
      repo: fakeRepo(),
      storage: fakeStorage(),
      publish: async () => {},
      previewBaseUrl: "",
    });
    const response = await app.request("/uploads", {
      method: "POST",
      body: JSON.stringify({ contentType: "application/pdf" }),
    });
    expect(response.status).toBe(400);
  });

  test("complete без загруженного файла отклоняется и событие не уходит", async () => {
    const repo = fakeRepo();
    const events: ImageUploadedEvent[] = [];
    const app = createApp({
      repo,
      storage: fakeStorage(undefined),
      publish: async (event) => void events.push(event),
      previewBaseUrl: "",
    });
    const created = await app.request("/uploads", {
      method: "POST",
      body: JSON.stringify({ contentType: "image/jpeg" }),
    });
    const { fileId } = (await created.json()) as { fileId: string };
    const response = await app.request(`/uploads/${fileId}/complete`, { method: "POST" });
    expect(response.status).toBe(400);
    expect(events).toHaveLength(0);
  });
});

describe("worker", () => {
  async function seeded() {
    const image = await sharp({
      create: { width: 2000, height: 1000, channels: 3, background: "#3b82f6" },
    })
      .png()
      .toBuffer();
    const repo = fakeRepo();
    const storage = fakeStorage(image);
    const fileId = crypto.randomUUID();
    await repo.create({ id: fileId, originalKey: `${fileId}/original.png`, contentType: "image/png" });
    return { repo, storage, event: { fileId, originalKey: `${fileId}/original.png` } };
  }

  test("делает три превью и ставит статус done", async () => {
    const { repo, storage, event } = await seeded();
    expect(await processImage(event, { repo, storage })).toBe("processed");

    expect(repo.rows.get(event.fileId)?.status).toBe("done");
    expect([...storage.previews.keys()].sort()).toEqual(
      [320, 800, 1600].map((w) => previewKey(event.fileId, w)).sort(),
    );
    const meta = await sharp(storage.previews.get(previewKey(event.fileId, 800))!).metadata();
    expect(meta.width).toBe(800);
    expect(meta.format).toBe("webp");
  });

  test("повторное событие для готового файла пропускается", async () => {
    const { repo, storage, event } = await seeded();
    await processImage(event, { repo, storage });
    expect(await processImage(event, { repo, storage })).toBe("skipped");
  });

  test("битый файл даёт статус failed и не бросает исключение", async () => {
    const repo = fakeRepo();
    const storage = fakeStorage(Buffer.from("это не картинка"));
    const fileId = crypto.randomUUID();
    await repo.create({ id: fileId, originalKey: `${fileId}/original.png`, contentType: "image/png" });

    await processImage({ fileId, originalKey: `${fileId}/original.png` }, { repo, storage });
    expect(repo.rows.get(fileId)?.status).toBe("failed");
    expect(repo.rows.get(fileId)?.error).toBeTruthy();
  });
});
