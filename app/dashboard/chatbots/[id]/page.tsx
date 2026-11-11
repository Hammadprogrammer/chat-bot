import Link from "next/link";
import { Alert, Badge, Card, LinkButton, Stat } from "@/components/ui";
import { requireChatbot } from "@/lib/auth";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { monthlyMessageCount } from "@/lib/rag";
import { CleanupButton } from "./cleanup-button";
import { UsageChart, type UsagePoint } from "./usage-chart";
import { storageSummary } from "@/lib/cleanup";

export default async function ChatbotOverviewPage({ params }: PageProps<"/dashboard/chatbots/[id]">) {
  const { id } = await params;
  const { chatbot } = await requireChatbot(id);

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 29);
  since.setUTCHours(0, 0, 0, 0);

  const weekAgo = new Date(since);
  weekAgo.setUTCDate(weekAgo.getUTCDate() + 23);
  const [usage, sourceStats, convCount, openHandoffs, monthMessages, recent, storage, unanswered] = await Promise.all([
    prisma.usageDaily.findMany({ where: { chatbotId: chatbot.id, day: { gte: since } }, orderBy: { day: "asc" } }),
    prisma.knowledgeSource.groupBy({ by: ["status"], where: { chatbotId: chatbot.id }, _count: true, _sum: { chunkCount: true } }),
    prisma.conversation.count({ where: { chatbotId: chatbot.id } }),
    prisma.handoffRequest.count({ where: { chatbotId: chatbot.id, status: "OPEN" } }),
    monthlyMessageCount(chatbot.id),
    prisma.conversation.findMany({
      where: { chatbotId: chatbot.id },
      orderBy: { lastMessageAt: "desc" },
      take: 5,
      include: { messages: { orderBy: { createdAt: "asc" }, take: 1, select: { content: true } } },
    }),
    storageSummary(chatbot.id),
    prisma.unansweredLog.groupBy({ by: ["question"], where: { chatbotId: chatbot.id, createdAt: { gte: weekAgo } }, _count: true, orderBy: { _count: { question: "desc" } }, take: 8 }),
  ]);

  const byDay = new Map(usage.map((u) => [u.day.toISOString().slice(0, 10), u]));
  const series: UsagePoint[] = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(since);
    d.setUTCDate(since.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    const u = byDay.get(key);
    series.push({ day: key.slice(5), messages: u?.messages ?? 0, unanswered: u?.unanswered ?? 0, conversations: u?.conversations ?? 0 });
  }
  const totals = usage.reduce(
    (acc, u) => ({ messages: acc.messages + u.messages, unanswered: acc.unanswered + u.unanswered, tokens: acc.tokens + u.inputTokens + u.outputTokens }),
    { messages: 0, unanswered: 0, tokens: 0 },
  );
  const readySources = sourceStats.find((s) => s.status === "READY");
  const totalSources = sourceStats.reduce((n, s) => n + s._count, 0);
  const totalChunks = sourceStats.reduce((n, s) => n + (s._sum.chunkCount ?? 0), 0);
  const quotaPct = chatbot.monthlyMessageLimit ? Math.min(100, Math.round((monthMessages / chatbot.monthlyMessageLimit) * 100)) : 0;

  return (
    <>
      {totalChunks === 0 && (
        <Alert tone="yellow">
          This chatbot has no indexed knowledge yet.{" "}
          <Link href={`/dashboard/chatbots/${chatbot.id}/knowledge`} className="font-medium underline">
            Add a website, documents or FAQs
          </Link>{" "}
          so it can answer questions.
        </Alert>
      )}
      {!process.env.OPENAI_API_KEY && <Alert tone="red">OPENAI_API_KEY is not set — the chatbot cannot generate answers until it is configured.</Alert>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Messages (30d)" value={totals.messages.toLocaleString()} sub={`${totals.unanswered} unanswered`} />
        <Stat label="Conversations" value={convCount.toLocaleString()} sub={`${openHandoffs} open handoffs`} />
        <Stat label="Knowledge" value={`${totalChunks} chunks`} sub={`${readySources?._count ?? 0}/${totalSources} sources ready`} />
        <Stat
          label="This month"
          value={chatbot.monthlyMessageLimit ? `${quotaPct}%` : monthMessages.toLocaleString()}
          sub={chatbot.monthlyMessageLimit ? `${monthMessages.toLocaleString()} / ${chatbot.monthlyMessageLimit.toLocaleString()} messages` : "messages · unlimited plan"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Usage — last 30 days" description={`${totals.tokens.toLocaleString()} LLM tokens used`} className="lg:col-span-2">
          <UsageChart data={series} />
        </Card>
        <Card title="Quick actions">
          <div className="flex flex-col gap-2">
            <LinkButton variant="secondary" href={`/dashboard/chatbots/${chatbot.id}/knowledge`}>Add knowledge</LinkButton>
            <LinkButton variant="secondary" href={`/dashboard/chatbots/${chatbot.id}/embed`}>Get embed code</LinkButton>
            <LinkButton variant="secondary" href={`/dashboard/chatbots/${chatbot.id}/settings`}>Customize branding & prompt</LinkButton>
          </div>
          <dl className="mt-5 space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-zinc-500">Model</dt><dd className="font-medium">{chatbot.model || `${env().OPENAI_CHAT_MODEL} (default)`}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Allowed domains</dt><dd className="font-medium">{chatbot.allowedDomains.length || "Any (not restricted)"}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Handoff</dt><dd className="font-medium">{chatbot.handoffEnabled && (chatbot.supportEmail || chatbot.supportUrl) ? "Enabled" : "Off"}</dd></div>
          </dl>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Storage & retention"
          description={chatbot.retentionDays ? `Conversations are kept for ${chatbot.retentionDays} days, then deleted automatically. Stats and leads are never deleted.` : "Conversations are kept forever (change in Settings)."}
          action={<CleanupButton chatbotId={chatbot.id} retentionDays={chatbot.retentionDays} />}
        >
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div><dt className="text-zinc-500">Conversations stored</dt><dd className="text-xl font-semibold">{storage.conversations.toLocaleString()}</dd></div>
            <div><dt className="text-zinc-500">Messages</dt><dd className="text-xl font-semibold">{storage.messages.toLocaleString()}</dd></div>
            <div><dt className="text-zinc-500">Approx. size</dt><dd className="text-xl font-semibold">{storage.approxMb < 0.01 ? "<0.01" : storage.approxMb} MB</dd></div>
          </dl>
          <p className="mt-3 text-xs text-zinc-500">Last cleanup: {chatbot.lastCleanupAt ? chatbot.lastCleanupAt.toLocaleString() : "not yet run"} · nightly at 02:00 UTC</p>
        </Card>
        <Card title="Unanswered questions (7 days)" description="What visitors asked that the bot could not answer — add these to Knowledge or FAQs.">
          {unanswered.length === 0 ? (
            <p className="text-sm text-zinc-500">Nothing unanswered this week.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {unanswered.map((u) => (
                <li key={u.question} className="flex items-start justify-between gap-3">
                  <span className="text-zinc-800 dark:text-zinc-200">{u.question}</span>
                  <Badge>{u._count}×</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Recent conversations" action={<LinkButton size="sm" variant="ghost" href={`/dashboard/chatbots/${chatbot.id}/conversations`}>View all</LinkButton>}>
        {recent.length === 0 ? (
          <p className="text-sm text-zinc-500">No conversations yet. Install the widget to start collecting chats.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {recent.map((c) => (
              <li key={c.id}>
                <Link href={`/dashboard/chatbots/${chatbot.id}/conversations/${c.id}`} className="flex items-center justify-between gap-4 py-3 text-sm hover:text-indigo-600">
                  <span className="truncate">{c.messages[0]?.content ?? "(empty)"}</span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-zinc-500">
                    {c.unansweredCount > 0 && <Badge tone="yellow">{c.unansweredCount} unanswered</Badge>}
                    {c.lastMessageAt.toLocaleString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
