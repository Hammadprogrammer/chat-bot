import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, EmptyState, SubmitButton } from "@/components/ui";
import { resolveHandoff } from "@/lib/actions/chatbots";
import { requireChatbot } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Handoff requests" };

export default async function HandoffsPage({ params }: PageProps<"/dashboard/chatbots/[id]/handoffs">) {
  const { id } = await params;
  const { chatbot } = await requireChatbot(id);
  const handoffs = await prisma.handoffRequest.findMany({ where: { chatbotId: chatbot.id }, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 200 });

  return (
    <Card title="Human handoff requests" description="Visitors who asked for support when the assistant could not answer.">
      {handoffs.length === 0 ? (
        <EmptyState title="No handoff requests" description="When the bot can't answer and a visitor leaves their email, it shows up here." />
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {handoffs.map((h) => (
            <li key={h.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-zinc-900 dark:text-zinc-50">
                  {h.name ? `${h.name} · ` : ""}
                  <a href={`mailto:${h.email}`} className="text-indigo-600 hover:underline">{h.email}</a>
                </p>
                <p className="mt-0.5 whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{h.message}</p>
                <p className="mt-1 text-xs text-zinc-500">
                  {h.createdAt.toLocaleString()}
                  {h.pageUrl && ` · ${h.pageUrl}`}
                  {h.conversationId && (
                    <>
                      {" · "}
                      <Link href={`/dashboard/chatbots/${chatbot.id}/conversations/${h.conversationId}`} className="underline">view conversation</Link>
                    </>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={h.status === "OPEN" ? "yellow" : "green"}>{h.status.toLowerCase()}</Badge>
                {h.status === "OPEN" && (
                  <form action={resolveHandoff.bind(null, chatbot.id, h.id)}>
                    <SubmitButton size="sm" variant="secondary" pendingText="…">Mark resolved</SubmitButton>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
