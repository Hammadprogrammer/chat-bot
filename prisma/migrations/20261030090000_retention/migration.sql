-- Data retention (default: keep conversations 7 days) + compact log of unanswered questions
ALTER TABLE "Chatbot" ADD COLUMN "retentionDays" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "Chatbot" ADD COLUMN "lastCleanupAt" TIMESTAMP(3);

CREATE TABLE "UnansweredLog" (
    "id" TEXT NOT NULL,
    "chatbotId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "language" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UnansweredLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "UnansweredLog_chatbotId_createdAt_idx" ON "UnansweredLog"("chatbotId", "createdAt");
ALTER TABLE "UnansweredLog" ADD CONSTRAINT "UnansweredLog_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "Chatbot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
