import type { Metadata } from "next";
import Link from "next/link";
import { Badge, EmptyState, LinkButton, Stat } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireUser();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [chatbots, usage, openHandoffs] = await Promise.all([
    prisma.chatbot.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { sources: true, conversations: true } } },
    }),
    prisma.usageDaily.aggregate({ where: { chatbot: { userId: user.id }, day: { gte: monthStart } }, _sum: { messages: true, unanswered: true, conversations: true } }),
    prisma.handoffRequest.count({ where: { chatbot: { userId: user.id }, status: "OPEN" } }),
  ]);
  const messages = usage._sum.messages ?? 0;
  const unanswered = usage._sum.unanswered ?? 0;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">Your chatbots</h1>
          <p className="text-sm text-zinc-500">Each chatbot has its own isolated knowledge base and embed script.</p>
        </div>
        <LinkButton href="/dashboard/chatbots/new">New chatbot</LinkButton>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Chatbots" value={chatbots.length} />
        <Stat label="Messages this month" value={messages.toLocaleString()} />
        <Stat label="Answer rate" value={messages ? `${Math.round(((messages - unanswered) / messages) * 100)}%` : "—"} sub={`${unanswered} unanswered`} />
        <Stat label="Open handoffs" value={openHandoffs} />
      </div>

      {chatbots.length === 0 ? (
        <EmptyState
          title="Create your first chatbot"
          description="Add your website URL, upload documents or write FAQs, then paste one script tag into your site."
          action={<LinkButton href="/dashboard/chatbots/new">Create chatbot</LinkButton>}
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {chatbots.map((bot) => (
            <li key={bot.id}>
              <Link
                href={`/dashboard/chatbots/${bot.id}`}
                className="flex h-full flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-indigo-300 hover:shadow dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-indigo-700"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold text-white" style={{ background: bot.primaryColor }}>
                      {bot.name.charAt(0).toUpperCase()}
                    </span>
                    <div>
                      <p className="font-semibold text-zinc-900 dark:text-white">{bot.name}</p>
                      <p className="text-xs text-zinc-500">{bot.websiteUrl ?? "No website set"}</p>
                    </div>
                  </div>
                  <Badge tone={bot.active ? "green" : "gray"}>{bot.active ? "Active" : "Paused"}</Badge>
                </div>
                <p className="line-clamp-2 min-h-[2.5rem] text-sm text-zinc-500">{bot.description ?? "No description"}</p>
                <div className="mt-auto flex gap-4 text-xs text-zinc-500">
                  <span>{bot._count.sources} sources</span>
                  <span>{bot._count.conversations} conversations</span>
                  <span>{bot.allowedDomains.length} domains</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
