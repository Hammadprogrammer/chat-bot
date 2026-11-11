-- Chat model is now provider-agnostic: empty string means "use OPENAI_CHAT_MODEL from the server".
ALTER TABLE "Chatbot" ALTER COLUMN "model" SET DEFAULT '';
UPDATE "Chatbot" SET "model" = '' WHERE "model" = 'gpt-4o-mini';
