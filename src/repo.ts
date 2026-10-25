import postgres from "postgres";

export type ImageStatus = "pending" | "queued" | "processing" | "done" | "failed";

export interface ImageRow {
  id: string;
  originalKey: string;
  contentType: string;
  status: ImageStatus;
  previews: Record<string, string> | null;
  error: string | null;
}

export interface ImageRepo {
  create(row: Pick<ImageRow, "id" | "originalKey" | "contentType">): Promise<void>;
  get(id: string): Promise<ImageRow | null>;
  setStatus(id: string, status: ImageStatus, error?: string): Promise<void>;
  setDone(id: string, previews: Record<string, string>): Promise<void>;
}

interface DbRow {
  id: string;
  original_key: string;
  content_type: string;
  status: ImageStatus;
  previews: Record<string, string> | null;
  error: string | null;
}

export function createSql(databaseUrl: string) {
  return postgres(databaseUrl, { max: 5 });
}

export type Sql = ReturnType<typeof createSql>;

export async function migrate(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS images (
      id uuid PRIMARY KEY,
      original_key text NOT NULL,
      content_type text NOT NULL,
      status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'queued', 'processing', 'done', 'failed')),
      previews jsonb,
      error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
}

export function createRepo(sql: Sql): ImageRepo {
  return {
    async create({ id, originalKey, contentType }) {
      await sql`
        INSERT INTO images (id, original_key, content_type)
        VALUES (${id}, ${originalKey}, ${contentType})
      `;
    },

    async get(id) {
      const rows = await sql<DbRow[]>`SELECT * FROM images WHERE id = ${id}`;
      const row = rows[0];
      if (!row) return null;
      return {
        id: row.id,
        originalKey: row.original_key,
        contentType: row.content_type,
        status: row.status,
        previews: row.previews,
        error: row.error,
      };
    },

    async setStatus(id, status, error) {
      await sql`
        UPDATE images
        SET status = ${status}, error = ${error ?? null}, updated_at = now()
        WHERE id = ${id}
      `;
    },

    async setDone(id, previews) {
      await sql`
        UPDATE images
        SET status = 'done', previews = ${sql.json(previews)}, error = NULL, updated_at = now()
        WHERE id = ${id}
      `;
    },
  };
}
