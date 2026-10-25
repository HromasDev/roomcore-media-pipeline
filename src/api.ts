import { createApp } from "./app";
import { config } from "./config";
import { createKafka, createPublisher, ensureTopic } from "./kafka";
import { createRepo, createSql, migrate } from "./repo";
import { createStorage, ensureBuckets } from "./storage";

const sql = createSql(config.DATABASE_URL);
await migrate(sql);
await ensureBuckets(config);

const kafka = createKafka(config);
await ensureTopic(kafka, config.KAFKA_TOPIC);
const publisher = await createPublisher(kafka, config.KAFKA_TOPIC);

const app = createApp({
  repo: createRepo(sql),
  storage: createStorage(config),
  publish: publisher.publish,
  previewBaseUrl: config.S3_PUBLIC_URL,
});

const server = Bun.serve({ port: config.PORT, fetch: app.fetch });
console.log(`api: http://localhost:${server.port}`);

async function shutdown() {
  server.stop();
  await publisher.disconnect();
  await sql.end();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
