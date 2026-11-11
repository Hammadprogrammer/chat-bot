import type { Chatbot } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hostnameFromUrl, isDomainAllowed } from "./domains";
import { prisma } from "./prisma";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code = "error") {
    super(message);
  }
}

export function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function json(data: unknown, init: { status?: number; origin?: string | null; headers?: Record<string, string> } = {}) {
  return NextResponse.json(data, { status: init.status ?? 200, headers: { ...corsHeaders(init.origin ?? null), ...init.headers } });
}

export function error(e: unknown, origin: string | null = null) {
  if (e instanceof ApiError) return json({ error: e.message, code: e.code }, { status: e.status, origin });
  if (e instanceof z.ZodError) return json({ error: e.issues[0]?.message ?? "Invalid request", code: "validation" }, { status: 400, origin });
  console.error(e);
  return json({ error: "Something went wrong", code: "internal" }, { status: 500, origin });
}

export function preflight(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

export async function parseBody<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, "Invalid JSON body", "validation");
  }
  return schema.parse(body);
}

/** Origin the widget is embedded on: prefer Origin header, fall back to Referer. */
export function requestHost(req: Request) {
  const origin = req.headers.get("origin");
  return hostnameFromUrl(origin) ?? hostnameFromUrl(req.headers.get("referer"));
}

/**
 * Resolve a chatbot by its public key and enforce the authorized-domain allow-list.
 * Used by every public widget endpoint.
 */
const botCache = new Map<string, { bot: Chatbot | null; at: number }>();
const BOT_CACHE_MS = 20_000;

export async function resolvePublicChatbot(req: Request, publicKey: string | null) {
  if (!publicKey || !/^[a-zA-Z0-9_-]{8,64}$/.test(publicKey)) throw new ApiError(400, "Missing chatbot key", "bad_key");
  // Short-lived per-instance cache: saves a DB round-trip on every widget message.
  const cached = botCache.get(publicKey);
  let chatbot = cached && Date.now() - cached.at < BOT_CACHE_MS ? cached.bot : undefined;
  if (chatbot === undefined) {
    chatbot = await prisma.chatbot.findUnique({ where: { publicKey } });
    botCache.set(publicKey, { bot: chatbot, at: Date.now() });
    if (botCache.size > 500) botCache.delete(botCache.keys().next().value!);
  }
  if (!chatbot || !chatbot.active) throw new ApiError(404, "Chatbot not found or inactive", "not_found");
  const host = requestHost(req);
  // Requests from this app's own origin (dashboard live preview) are always allowed.
  const selfHost = req.headers.get("host")?.split(":")[0].toLowerCase() ?? null;
  const isSelf = host !== null && host === selfHost;
  if (!isSelf && !isDomainAllowed(host, chatbot.allowedDomains)) {
    throw new ApiError(403, "This chatbot is not authorized for this domain", "domain_not_allowed");
  }
  return chatbot;
}
