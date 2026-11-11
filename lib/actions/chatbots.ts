"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireChatbot, requireUser } from "@/lib/auth";
import { generateSystemPromptFromSite } from "@/lib/ai";
import { cleanupChatbot } from "@/lib/cleanup";
import { parseDomainList } from "@/lib/domains";
import { prisma } from "@/lib/prisma";

export type ActionState = { error?: string; success?: string };

const MAX_CHATBOTS_PER_USER = 25;

const CreateSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(80),
  websiteUrl: z.union([z.literal(""), z.url("Enter a valid URL (https://…)")]).optional(),
  description: z.string().trim().max(500).optional(),
});

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color must be a hex value like #2563eb");

const SettingsSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500),
  websiteUrl: z.union([z.literal(""), z.url("Enter a valid website URL")]),
  active: z.boolean(),
  model: z.string().trim().max(80).regex(/^[\w.\-/:]*$/, "Model name contains invalid characters"),
  temperature: z.coerce.number().min(0).max(1),
  systemPrompt: z.string().trim().min(10, "Prompt is too short").max(4000),
  welcomeMessage: z.string().trim().min(1).max(500),
  fallbackMessage: z.string().trim().min(1).max(500),
  similarityCutoff: z.coerce.number().min(0).max(0.9),
  maxContextChunks: z.coerce.number().int().min(1).max(12),
  botName: z.string().trim().min(1).max(40),
  primaryColor: hexColor,
  position: z.enum(["left", "right"]),
  avatarUrl: z.union([z.literal(""), z.url()]),
  launcherText: z.string().trim().max(30),
  poweredByLabel: z.boolean(),
  poweredByText: z.string().trim().max(60),
  showSources: z.boolean(),
  allowGeneralAnswers: z.boolean(),
  responseGuidelines: z.string().trim().max(4000, "Training rules are too long (4000 characters max)"),
  supportEmail: z.union([z.literal(""), z.email("Enter a valid support email")]),
  supportUrl: z.union([z.literal(""), z.url("Enter a valid support URL")]),
  handoffEnabled: z.boolean(),
  allowedDomains: z.string().max(5000),
  monthlyMessageLimit: z.coerce.number().int().min(0).max(1_000_000),
  rateLimitPerMinute: z.coerce.number().int().min(0).max(600),
  retentionDays: z.coerce.number().int().min(0).max(3650),
});

function str(fd: FormData, key: string) {
  return String(fd.get(key) ?? "");
}
function bool(fd: FormData, key: string) {
  return fd.get(key) === "on" || fd.get(key) === "true";
}

export async function createChatbot(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = CreateSchema.safeParse({ name: str(formData, "name"), websiteUrl: str(formData, "websiteUrl"), description: str(formData, "description") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  if ((await prisma.chatbot.count({ where: { userId: user.id } })) >= MAX_CHATBOTS_PER_USER) return { error: "Chatbot limit reached" };

  const domains = parsed.data.websiteUrl ? parseDomainList(parsed.data.websiteUrl) : [];
  const bot = await prisma.chatbot.create({
    data: {
      userId: user.id,
      publicKey: `pk_${randomBytes(18).toString("base64url")}`,
      name: parsed.data.name,
      websiteUrl: parsed.data.websiteUrl || null,
      description: parsed.data.description || null,
      botName: parsed.data.name.slice(0, 40),
      allowedDomains: domains,
      systemPrompt: `You are the virtual assistant for ${parsed.data.name}. Help visitors by answering questions about the website, its products and services using only the provided context.`,
    },
  });
  revalidatePath("/dashboard");
  redirect(`/dashboard/chatbots/${bot.id}/knowledge`);
}

export async function updateChatbotSettings(chatbotId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { chatbot } = await requireChatbot(chatbotId);
  const parsed = SettingsSchema.safeParse({
    name: str(formData, "name"),
    description: str(formData, "description"),
    websiteUrl: str(formData, "websiteUrl"),
    active: bool(formData, "active"),
    model: str(formData, "model"),
    temperature: str(formData, "temperature"),
    systemPrompt: str(formData, "systemPrompt"),
    welcomeMessage: str(formData, "welcomeMessage"),
    fallbackMessage: str(formData, "fallbackMessage"),
    similarityCutoff: str(formData, "similarityCutoff"),
    maxContextChunks: str(formData, "maxContextChunks"),
    botName: str(formData, "botName"),
    primaryColor: str(formData, "primaryColor"),
    position: str(formData, "position"),
    avatarUrl: str(formData, "avatarUrl"),
    launcherText: str(formData, "launcherText"),
    poweredByLabel: bool(formData, "poweredByLabel"),
    poweredByText: str(formData, "poweredByText"),
    showSources: bool(formData, "showSources"),
    allowGeneralAnswers: bool(formData, "allowGeneralAnswers"),
    responseGuidelines: str(formData, "responseGuidelines"),
    supportEmail: str(formData, "supportEmail"),
    supportUrl: str(formData, "supportUrl"),
    handoffEnabled: bool(formData, "handoffEnabled"),
    allowedDomains: str(formData, "allowedDomains"),
    monthlyMessageLimit: str(formData, "monthlyMessageLimit"),
    rateLimitPerMinute: str(formData, "rateLimitPerMinute"),
    retentionDays: str(formData, "retentionDays"),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: `${issue.path.join(".")}: ${issue.message}` };
  }
  const d = parsed.data;
  await prisma.chatbot.update({
    where: { id: chatbot.id },
    data: {
      ...d,
      websiteUrl: d.websiteUrl || null,
      description: d.description || null,
      avatarUrl: d.avatarUrl || null,
      launcherText: d.launcherText || null,
      poweredByText: d.poweredByText || "Powered by AI Chatbot",
      supportEmail: d.supportEmail || null,
      supportUrl: d.supportUrl || null,
      allowedDomains: parseDomainList(d.allowedDomains),
    },
  });
  revalidatePath(`/dashboard/chatbots/${chatbot.id}`, "layout");
  return { success: "Settings saved" };
}

export async function rotatePublicKey(chatbotId: string) {
  const { chatbot } = await requireChatbot(chatbotId);
  await prisma.chatbot.update({ where: { id: chatbot.id }, data: { publicKey: `pk_${randomBytes(18).toString("base64url")}` } });
  revalidatePath(`/dashboard/chatbots/${chatbot.id}`, "layout");
}

export async function deleteChatbot(chatbotId: string) {
  const { chatbot } = await requireChatbot(chatbotId);
  await prisma.chatbot.delete({ where: { id: chatbot.id } });
  revalidatePath("/dashboard");
  redirect("/dashboard");
}

/** Draft a professional system prompt from the indexed website content. Returns the text (not saved). */
export async function generatePromptFromWebsite(chatbotId: string): Promise<{ prompt?: string; error?: string }> {
  const { chatbot } = await requireChatbot(chatbotId);
  const [overview, sample] = await Promise.all([
    prisma.chunk.findMany({ where: { chatbotId: chatbot.id, title: { startsWith: "Website overview" } }, select: { content: true }, take: 2 }),
    prisma.chunk.findMany({ where: { chatbotId: chatbot.id, NOT: { title: { startsWith: "Website overview" } } }, orderBy: { createdAt: "asc" }, select: { content: true }, take: 4 }),
  ]);
  if (overview.length === 0 && sample.length === 0) return { error: "Index your website first (Knowledge tab), then generate the prompt." };
  const host = chatbot.websiteUrl ? new URL(chatbot.websiteUrl).hostname.replace(/^www\./, "") : chatbot.name;
  try {
    const prompt = await generateSystemPromptFromSite({
      businessName: chatbot.name,
      host,
      overview: overview.map((o) => o.content).join("\n\n"),
      sampleText: sample.map((s) => s.content).join("\n\n"),
    });
    return { prompt };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not generate a prompt right now" };
  }
}

export async function runCleanupNow(chatbotId: string) {
  const { chatbot } = await requireChatbot(chatbotId);
  const result = await cleanupChatbot(chatbot.id);
  revalidatePath(`/dashboard/chatbots/${chatbot.id}`, "layout");
  return result;
}

export async function resolveHandoff(chatbotId: string, handoffId: string) {
  const { chatbot } = await requireChatbot(chatbotId);
  await prisma.handoffRequest.updateMany({ where: { id: handoffId, chatbotId: chatbot.id }, data: { status: "RESOLVED", resolvedAt: new Date() } });
  revalidatePath(`/dashboard/chatbots/${chatbot.id}/handoffs`);
}

export async function deleteConversation(chatbotId: string, conversationId: string) {
  const { chatbot } = await requireChatbot(chatbotId);
  await prisma.conversation.deleteMany({ where: { id: conversationId, chatbotId: chatbot.id } });
  revalidatePath(`/dashboard/chatbots/${chatbot.id}/conversations`);
  redirect(`/dashboard/chatbots/${chatbot.id}/conversations`);
}
