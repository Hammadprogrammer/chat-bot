-- Processing lock + rate-limit pause for resumable, self-healing ingestion
ALTER TABLE "KnowledgeSource" ADD COLUMN "lockedAt" TIMESTAMP(3);
ALTER TABLE "KnowledgeSource" ADD COLUMN "pausedUntil" TIMESTAMP(3);

-- Keyword (full-text) index for hybrid retrieval
CREATE INDEX "Chunk_content_fts_idx" ON "Chunk" USING gin (to_tsvector('english', "content"));

-- Better retrieval defaults (more context, slightly stricter cutoff); update bots still on old defaults
ALTER TABLE "Chatbot" ALTER COLUMN "similarityCutoff" SET DEFAULT 0.4;
ALTER TABLE "Chatbot" ALTER COLUMN "maxContextChunks" SET DEFAULT 8;
UPDATE "Chatbot" SET "similarityCutoff" = 0.4 WHERE "similarityCutoff" = 0.35;
UPDATE "Chatbot" SET "maxContextChunks" = 8 WHERE "maxContextChunks" = 6;
