/**
 * Migration: Add knowledge_document table with pgvector support.
 *
 * Creates the knowledge_document table which stores curated culinary
 * knowledge base documents with their vector embeddings for semantic search.
 * Requires the pgvector extension to be enabled on the PostgreSQL instance.
 *
 * Run: tsx packages/server/src/db/migrations/add-knowledge-vector.ts
 */
import "dotenv/config";
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(connectionString);

async function run() {
  console.log("Starting migration: add knowledge_document with pgvector...");

  // Enable pgvector extension (requires PostgreSQL 15+ on Railway)
  try {
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    console.log("pgvector extension enabled.");
  } catch (err) {
    console.error("Failed to enable pgvector extension:", err);
    console.error("Ensure your PostgreSQL instance supports pgvector (Railway PostgreSQL 15+).");
    process.exit(1);
  }

  // Create the knowledge_document table
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS knowledge_document (
        document_id    SERIAL PRIMARY KEY,
        file_path      VARCHAR(500) NOT NULL UNIQUE,
        title          VARCHAR(200) NOT NULL,
        category       VARCHAR(100) NOT NULL,
        tags           TEXT[]       NOT NULL DEFAULT '{}',
        body           TEXT         NOT NULL,
        content_hash   VARCHAR(64)  NOT NULL,
        embedding      vector(1536),
        embedded_at    TIMESTAMP,
        created_dttm   TIMESTAMP    NOT NULL DEFAULT NOW(),
        updated_dttm   TIMESTAMP    NOT NULL DEFAULT NOW()
      )
    `;
    console.log("knowledge_document table created.");
  } catch {
    console.log("knowledge_document table already exists — skipping.");
  }

  // IVFFlat index for fast cosine similarity search
  // lists=10 is appropriate for up to ~10k documents (100 * sqrt(N) heuristic)
  try {
    await sql`
      CREATE INDEX IF NOT EXISTS idx_knowledge_document_embedding
      ON knowledge_document USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 10)
    `;
    console.log("IVFFlat cosine index created.");
  } catch {
    console.log("IVFFlat index already exists — skipping.");
  }

  console.log("Migration complete!");
  await sql.end();
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
