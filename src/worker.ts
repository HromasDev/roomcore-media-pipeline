import { config } from "./config";
import { imageUploadedSchema } from "./events";
import { createKafka, ensureTopic } from "./kafka";
import { processImage } from "./process-image";
import { createRepo, createSql, migrate } from "./repo";
import { createStorage } from "./storage";

const sql = createSql(config.DATABASE_URL);
await migrate(sql);
const repo = createRepo(sql);
const storage = createStorage(config);

const kafka = createKafka(config);
await ensureTopic(kafka, config.KAFKA_TOPIC);

// Все экземпляры воркера с одним groupId делят партиции топика между собой
const consumer = kafka.consumer({ groupId: config.KAFKA_GROUP_ID });
await consumer.connect();
await consumer.subscribe({ topic: config.KAFKA_TOPIC, fromBeginning: true });

await consumer.run({
  // Offset коммитится после успешного возврата из eachMessage: если воркер упал посреди
  // обработки, событие придёт заново (at-least-once)
  eachMessage: async ({ message, partition }) => {
    const parsed = imageUploadedSchema.safeParse(JSON.parse(message.value?.toString() ?? "null"));
    if (!parsed.success) {
      console.warn(`worker: пропускаю некорректное событие в партиции ${partition}`);
      return;
    }
    const result = await processImage(parsed.data, { repo, storage });
    console.log(`worker: ${parsed.data.fileId} ${result} (партиция ${partition})`);
  },
});

console.log(`worker: слушаю топик ${config.KAFKA_TOPIC}`);

async function shutdown() {
  await consumer.disconnect();
  await sql.end();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
