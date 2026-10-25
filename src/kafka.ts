import { Kafka, logLevel, type Producer } from "kafkajs";
import type { Config } from "./config";
import type { ImageUploadedEvent } from "./events";

export function createKafka(config: Config): Kafka {
  return new Kafka({
    clientId: "roomcore-media-pipeline",
    brokers: config.KAFKA_BROKERS.split(","),
    logLevel: logLevel.WARN,
  });
}

// Три партиции: до трёх экземпляров воркера в одной группе делят события между собой
export async function ensureTopic(kafka: Kafka, topic: string): Promise<void> {
  const admin = kafka.admin();
  await admin.connect();
  try {
    await admin.createTopics({ topics: [{ topic, numPartitions: 3, replicationFactor: 1 }] });
  } finally {
    await admin.disconnect();
  }
}

export async function createPublisher(kafka: Kafka, topic: string) {
  const producer: Producer = kafka.producer({ idempotent: true });
  await producer.connect();

  return {
    // Ключ сообщения = fileId: события одного файла попадают в одну партицию и идут по порядку
    async publish(event: ImageUploadedEvent): Promise<void> {
      await producer.send({
        topic,
        acks: -1,
        messages: [{ key: event.fileId, value: JSON.stringify(event) }],
      });
    },
    disconnect: () => producer.disconnect(),
  };
}
