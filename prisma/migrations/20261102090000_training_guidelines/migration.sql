-- Owner-written "how to answer" rules used in every prompt
ALTER TABLE "Chatbot" ADD COLUMN "responseGuidelines" TEXT NOT NULL DEFAULT '';
