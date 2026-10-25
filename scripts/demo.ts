// Сквозная проверка против запущенных api и worker: загрузка по presigned URL, событие, превью
import sharp from "sharp";

const api = process.env.API_URL ?? "http://localhost:3000";

const image = await sharp({
  create: { width: 2400, height: 1600, channels: 3, background: "#10b981" },
})
  .png()
  .toBuffer();

const created = await fetch(`${api}/uploads`, {
  method: "POST",
  body: JSON.stringify({ contentType: "image/png" }),
});
const { fileId, uploadUrl } = (await created.json()) as { fileId: string; uploadUrl: string };
console.log("fileId:", fileId);

const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "image/png" }, body: image });
if (!put.ok) throw new Error(`загрузка в S3 не удалась: ${put.status}`);
console.log("загружено напрямую в S3");

const complete = await fetch(`${api}/uploads/${fileId}/complete`, { method: "POST" });
console.log("complete:", complete.status);

for (let attempt = 0; attempt < 30; attempt++) {
  const status = (await (await fetch(`${api}/images/${fileId}`)).json()) as {
    status: string;
    previews: Record<string, string> | null;
    error: string | null;
  };
  console.log("статус:", status.status);
  if (status.status === "done") {
    console.log(status.previews);
    const head = await fetch(Object.values(status.previews!)[0]!);
    console.log("превью доступно публично:", head.status);
    process.exit(head.ok ? 0 : 1);
  }
  if (status.status === "failed") throw new Error(status.error ?? "failed");
  await Bun.sleep(1000);
}
throw new Error("превью не появились за 30 секунд");
