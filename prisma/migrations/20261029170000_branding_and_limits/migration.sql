-- Per-chatbot "Powered by" text, source links toggle, general-answer mode
ALTER TABLE "Chatbot" ADD COLUMN "poweredByText" TEXT NOT NULL DEFAULT 'Powered by AI Chatbot';
ALTER TABLE "Chatbot" ADD COLUMN "showSources" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Chatbot" ADD COLUMN "allowGeneralAnswers" BOOLEAN NOT NULL DEFAULT true;

-- Limits: 0 = unlimited. Existing bots on the old defaults become unlimited.
ALTER TABLE "Chatbot" ALTER COLUMN "monthlyMessageLimit" SET DEFAULT 0;
ALTER TABLE "Chatbot" ALTER COLUMN "rateLimitPerMinute" SET DEFAULT 60;
UPDATE "Chatbot" SET "monthlyMessageLimit" = 0 WHERE "monthlyMessageLimit" = 1000;
UPDATE "Chatbot" SET "rateLimitPerMinute" = 60 WHERE "rateLimitPerMinute" = 20;

-- Faster answers: fewer context chunks by default; friendlier fallback
ALTER TABLE "Chatbot" ALTER COLUMN "maxContextChunks" SET DEFAULT 6;
UPDATE "Chatbot" SET "maxContextChunks" = 6 WHERE "maxContextChunks" = 8;
ALTER TABLE "Chatbot" ALTER COLUMN "fallbackMessage" SET DEFAULT 'I don''t have that specific information at the moment, but our team will be happy to help you directly.';
UPDATE "Chatbot" SET "fallbackMessage" = 'I don''t have that specific information at the moment, but our team will be happy to help you directly.' WHERE "fallbackMessage" = 'I couldn''t find an answer to that in my knowledge base.';
