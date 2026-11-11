import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { requireChatbot } from "@/lib/auth";
import { describeProgress } from "@/lib/ingest/process";
import { prisma } from "@/lib/prisma";
import { AddSourcePanel } from "./add-source";
import { SourceList, type SourceRow } from "./source-list";

export const metadata: Metadata = { title: "Knowledge base" };

export default async function KnowledgePage({ params }: PageProps<"/dashboard/chatbots/[id]">) {
  const { id } = await params;
  const { chatbot } = await requireChatbot(id);
  const sources = await prisma.knowledgeSource.findMany({
    where: { chatbotId: chatbot.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, type: true, name: true, url: true, status: true, error: true, chunkCount: true, pageCount: true, charCount: true, createdAt: true, payload: true, pausedUntil: true },
  });
  const rows: SourceRow[] = sources.map((s) => ({
    ...s,
    pausedUntil: undefined,
    progress: describeProgress(s),
    createdAt: s.createdAt.toISOString(),
    faqItems: s.type === "FAQ" ? ((s.payload as { items?: { question: string; answer: string }[] } | null)?.items ?? []) : undefined,
    payload: undefined,
  }));

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="lg:col-span-2">
        <AddSourcePanel chatbotId={chatbot.id} />
      </div>
      <Card
        className="lg:col-span-3"
        title="Sources"
        description={`${rows.length} source${rows.length === 1 ? "" : "s"} · ${rows.reduce((n, s) => n + s.chunkCount, 0)} indexed chunks. Only this chatbot can access them.`}
      >
        <SourceList chatbotId={chatbot.id} initial={rows} />
      </Card>
    </div>
  );
}
