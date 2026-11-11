import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge, Card, LinkButton, SubmitButton } from "@/components/ui";
import { deleteConversation } from "@/lib/actions/chatbots";
import { requireChatbot } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Conversation" };

export default async function ConversationPage({ params }: PageProps<"/dashboard/chatbots/[id]/conversations/[conversationId]">) {
  const { id, conversationId } = await params;
  const { chatbot } = await requireChatbot(id);
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, chatbotId: chatbot.id },
    include: { messages: { orderBy: { createdAt: "asc" } }, handoffs: true },
  });
  if (!conversation) notFound();
  const remove = deleteConversation.bind(null, chatbot.id, conversation.id);

  return (
    <Card
      title="Conversation"
      description={`Started ${conversation.startedAt.toLocaleString()} · ${conversation.pageUrl ?? "unknown page"} · visitor ${conversation.visitorId.slice(0, 10)}…`}
      action={
        <div className="flex gap-2">
          <LinkButton size="sm" variant="secondary" href={`/dashboard/chatbots/${chatbot.id}/conversations`}>Back</LinkButton>
          <form action={remove}>
            <SubmitButton size="sm" variant="danger" pendingText="Deleting…">Delete</SubmitButton>
          </form>
        </div>
      }
    >
      {conversation.handoffs.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950">
          <p className="font-medium text-amber-800 dark:text-amber-300">Human handoff requested</p>
          {conversation.handoffs.map((h) => (
            <p key={h.id} className="text-amber-800 dark:text-amber-200">
              {h.name ? `${h.name} · ` : ""}
              <a href={`mailto:${h.email}`} className="underline">{h.email}</a>: {h.message} <Badge tone={h.status === "OPEN" ? "yellow" : "green"}>{h.status.toLowerCase()}</Badge>
            </p>
          ))}
        </div>
      )}
      <ol className="flex flex-col gap-3">
        {conversation.messages.map((m) => {
          const sources = (m.sources as { title: string; url: string | null }[] | null) ?? [];
          return (
            <li key={m.id} className={m.role === "USER" ? "flex justify-end" : "flex justify-start"}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${m.role === "USER" ? "bg-indigo-600 text-white" : "border border-zinc-200 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"}`}>
                <p className="whitespace-pre-wrap">{m.content}</p>
                <div className={`mt-1.5 flex flex-wrap items-center gap-2 text-[11px] ${m.role === "USER" ? "text-indigo-100" : "text-zinc-500"}`}>
                  <span>{m.createdAt.toLocaleTimeString()}</span>
                  {m.role === "ASSISTANT" && !m.answered && <Badge tone="yellow">fallback</Badge>}
                  {m.role === "ASSISTANT" && m.latencyMs != null && <span>{(m.latencyMs / 1000).toFixed(1)}s</span>}
                  {m.role === "ASSISTANT" && (m.inputTokens || m.outputTokens) > 0 && <span>{m.inputTokens + m.outputTokens} tokens</span>}
                  {sources.length > 0 && (
                    <span>
                      Sources:{" "}
                      {sources.map((s, i) =>
                        s.url ? (
                          <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="underline">{s.title}</a>
                        ) : (
                          <span key={i}>{s.title}</span>
                        ),
                      ).reduce<React.ReactNode[]>((acc, el, i) => (i === 0 ? [el] : [...acc, ", ", el]), [])}
                    </span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
