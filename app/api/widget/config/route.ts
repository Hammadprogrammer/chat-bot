import { error, json, preflight, resolvePublicChatbot } from "@/lib/api";

export const runtime = "nodejs";

export function OPTIONS(req: Request) {
  return preflight(req);
}

export async function GET(req: Request) {
  const origin = req.headers.get("origin");
  try {
    const key = new URL(req.url).searchParams.get("key");
    const bot = await resolvePublicChatbot(req, key);
    return json(
      {
        key: bot.publicKey,
        botName: bot.botName,
        welcomeMessage: bot.welcomeMessage,
        primaryColor: bot.primaryColor,
        position: bot.position,
        avatarUrl: bot.avatarUrl,
        launcherText: bot.launcherText,
        poweredBy: bot.poweredByLabel,
        poweredByText: bot.poweredByText,
        handoffEnabled: bot.handoffEnabled && Boolean(bot.supportEmail || bot.supportUrl),
        supportUrl: bot.supportUrl,
        supportEmail: bot.supportEmail,
      },
      { origin, headers: { "Cache-Control": "public, max-age=60" } },
    );
  } catch (e) {
    return error(e, origin);
  }
}
