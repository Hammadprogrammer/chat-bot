import Link from "next/link";
import { Badge } from "@/components/ui";
import { requireChatbot } from "@/lib/auth";
import { ChatbotTabs } from "./tabs";

export default async function ChatbotLayout({ children, params }: LayoutProps<"/dashboard/chatbots/[id]">) {
  const { id } = await params;
  const { chatbot } = await requireChatbot(id);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
            ← All chatbots
          </Link>
          <span className="text-zinc-300">/</span>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-white">{chatbot.name}</h1>
          <Badge tone={chatbot.active ? "green" : "gray"}>{chatbot.active ? "Active" : "Paused"}</Badge>
        </div>
        <code className="rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{chatbot.publicKey}</code>
      </div>
      <ChatbotTabs id={chatbot.id} />
      {children}
    </>
  );
}
