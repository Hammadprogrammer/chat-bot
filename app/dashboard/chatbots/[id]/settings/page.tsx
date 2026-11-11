import type { Metadata } from "next";
import { requireChatbot } from "@/lib/auth";
import { env } from "@/lib/env";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ params }: PageProps<"/dashboard/chatbots/[id]/settings">) {
  const { id } = await params;
  const { chatbot } = await requireChatbot(id);
  return <SettingsForm chatbot={chatbot} defaultModel={env().OPENAI_CHAT_MODEL} />;
}
