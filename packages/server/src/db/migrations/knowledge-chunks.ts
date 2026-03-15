// @ts-nocheck — one-time migration script, not part of the application build
/**
 * Migration: knowledge-chunks
 *
 * Transforms the knowledge system from single-document embeddings to
 * chunk-based embeddings. Steps:
 *   1. Create knowledge_chunk table
 *   2. Add new columns to knowledge_document
 *   3. Migrate existing documents → single chunks (preserve data)
 *   4. Drop old embedding column from knowledge_document
 *   5. Create IVFFlat index on knowledge_chunk.embedding
 */

import "dotenv/config";
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(connectionString);

async function migrate() {
  try {
    // 1. Create knowledge_chunk table
    await sql`
      CREATE TABLE IF NOT EXISTS knowledge_chunk (
        chunk_id       SERIAL PRIMARY KEY,
        document_id    INTEGER NOT NULL REFERENCES knowledge_document(document_id) ON DELETE CASCADE,
        chunk_index    INTEGER NOT NULL,
        chunk_text     TEXT NOT NULL,
        token_count    INTEGER NOT NULL DEFAULT 0,
        embedding      vector(1536),
        embedded_at    TIMESTAMP,
        created_dttm   TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_knowledge_chunk_document
        ON knowledge_chunk(document_id)
    `;

    console.log("✓ Created knowledge_chunk table");

    // 2. Add new columns to knowledge_document (idempotent)
    const cols = [
      { name: "source_type", def: "VARCHAR(20) NOT NULL DEFAULT 'markdown'" },
      { name: "source_url", def: "VARCHAR(2000)" },
      { name: "original_filename", def: "VARCHAR(500)" },
      { name: "file_size_bytes", def: "INTEGER" },
      { name: "chunk_count", def: "INTEGER NOT NULL DEFAULT 0" },
      { name: "status", def: "VARCHAR(20) NOT NULL DEFAULT 'ready'" },
      { name: "error_message", def: "TEXT" },
    ];

    for (const col of cols) {
      const exists = await sql`
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'knowledge_document' AND column_name = ${col.name}
      `;
      if (exists.length === 0) {
        await sql.unsafe(
          `ALTER TABLE knowledge_document ADD COLUMN ${col.name} ${col.def}`
        );
      }
    }

    // Make file_path nullable
    try {
      await sql`ALTER TABLE knowledge_document ALTER COLUMN file_path DROP NOT NULL`;
    } catch { /* already nullable */ }

    // Drop unique constraint on file_path if it exists
    try {
      await sql`ALTER TABLE knowledge_document DROP CONSTRAINT IF EXISTS knowledge_document_file_path_key`;
    } catch { /* constraint may not exist */ }

    console.log("✓ Added new columns to knowledge_document");

    // 3. Migrate existing documents → create one chunk per document
    const docs = await sql`
      SELECT document_id, body, embedding, embedded_at
      FROM knowledge_document
      WHERE document_id NOT IN (SELECT DISTINCT document_id FROM knowledge_chunk)
    `;

    for (const doc of docs) {
      const wordCount = (doc.body || "").split(/\s+/).filter(Boolean).length;
      const tokenEstimate = Math.ceil(wordCount / 0.75);

      if (doc.embedding) {
        await sql`
          INSERT INTO knowledge_chunk (document_id, chunk_index, chunk_text, token_count, embedding, embedded_at)
          VALUES (${doc.document_id}, 0, ${doc.body}, ${tokenEstimate}, ${doc.embedding}::vector, ${doc.embedded_at})
        `;
      } else {
        await sql`
          INSERT INTO knowledge_chunk (document_id, chunk_index, chunk_text, token_count)
          VALUES (${doc.document_id}, 0, ${doc.body}, ${tokenEstimate})
        `;
      }

      await sql`
        UPDATE knowledge_document
        SET chunk_count = 1, status = 'ready', source_type = 'markdown'
        WHERE document_id = ${doc.document_id}
      `;
    }

    console.log(`✓ Migrated ${docs.length} existing documents to chunks`);

    // 4. Drop old embedding columns from knowledge_document
    try {
      await sql`ALTER TABLE knowledge_document DROP COLUMN IF EXISTS embedding`;
      await sql`ALTER TABLE knowledge_document DROP COLUMN IF EXISTS embedded_at`;
      console.log("✓ Dropped embedding columns from knowledge_document");
    } catch (err) {
      console.warn("Could not drop embedding columns (may already be gone):", err);
    }

    // 5. Create IVFFlat index on knowledge_chunk.embedding
    const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM knowledge_chunk`;
    const lists = Math.max(1, Math.min(20, Math.floor(count / 10)));

    try {
      await sql`DROP INDEX IF EXISTS idx_knowledge_chunk_embedding`;
      await sql.unsafe(
        `CREATE INDEX idx_knowledge_chunk_embedding
         ON knowledge_chunk USING ivfflat (embedding vector_cosine_ops) WITH (lists = ${lists})`
      );
      console.log(`✓ Created IVFFlat index (lists=${lists})`);
    } catch (err) {
      console.warn("Could not create IVFFlat index (may need more data):", err);
    }

    console.log("\n✅ Migration complete");
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

migrate();
