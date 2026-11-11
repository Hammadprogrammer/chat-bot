import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, EmptyState, LinkButton } from "@/components/ui";
import { requireChatbot } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Conversations" };
const PAGE_SIZE = 25;

export default async function ConversationsPage({ params, searchParams }: PageProps<"/dashboard/chatbots/[id]/conversations">) {
  const { id } = await params;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const filter = sp.filter === "unanswered" ? "unanswered" : "all";
  const { chatbot } = await requireChatbot(id);

  const where = { chatbotId: chatbot.id, ...(filter === "unanswered" ? { unansweredCount: { gt: 0 } } : {}) };
  const [items, total] = await Promise.all([
    prisma.conversation.findMany({
      where,
      orderBy: { lastMessageAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { messages: { orderBy: { createdAt: "asc" }, take: 1, select: { content: true } } },
    }),
    prisma.conversation.count({ where }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const base = `/dashboard/chatbots/${chatbot.id}/conversations`;

  return (
    <Card
      title="Conversations"
      description={`${total} total`}
      action={
        <div className="flex gap-1">
          <LinkButton size="sm" variant={filter === "all" ? "secondary" : "ghost"} href={base}>All</LinkButton>
          <LinkButton size="sm" variant={filter === "unanswered" ? "secondary" : "ghost"} href={`${base}?filter=unanswered`}>Unanswered</LinkButton>
        </div>
      }
    >
      {items.length === 0 ? (
        <EmptyState title="No conversations yet" description="Once the widget is installed, visitor chats will appear here." />
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {items.map((c) => (
            <li key={c.id}>
              <Link href={`${base}/${c.id}`} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm hover:text-indigo-600">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{c.messages[0]?.content ?? "(empty)"}</p>
                  <p className="truncate text-xs text-zinc-500">{c.pageUrl ?? "Unknown page"}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-xs text-zinc-500">
                  {c.unansweredCount > 0 && <Badge tone="yellow">{c.unansweredCount} unanswered</Badge>}
                  <span>{c.messageCount} msgs</span>
                  <span>{c.lastMessageAt.toLocaleString()}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <LinkButton size="sm" variant="secondary" href={`${base}?filter=${filter}&page=${page - 1}`} aria-disabled={page <= 1} className={page <= 1 ? "pointer-events-none opacity-50" : ""}>
            Previous
          </LinkButton>
          <span className="text-zinc-500">Page {page} of {pages}</span>
          <LinkButton size="sm" variant="secondary" href={`${base}?filter=${filter}&page=${page + 1}`} className={page >= pages ? "pointer-events-none opacity-50" : ""}>
            Next
          </LinkButton>
        </div>
      )}
    </Card>
  );
}
