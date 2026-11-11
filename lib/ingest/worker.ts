import type { KnowledgeSource } from "@prisma/client";
import { after } from "next/server";
import { appUrl, env } from "@/lib/env";
import { describeProgress, processSource } from "./process";

const encoder = new TextEncoder();

/** HMAC token that lets the worker call its own process endpoint without a user session. */
export async function internalToken(sourceId: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(env().AUTH_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(`process:${sourceId}`));
  return Buffer.from(sig).toString("base64url");
}

export async function verifyInternalToken(sourceId: string, token: string | null) {
  if (!token) return false;
  const expected = await internalToken(sourceId);
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

export function serializeSource(source: KnowledgeSource, busy = false) {
  return {
    id: source.id,
    status: source.status,
    error: source.error,
    chunkCount: source.chunkCount,
    pageCount: source.pageCount,
    charCount: source.charCount,
    progress: describeProgress(source),
    pausedUntil: source.pausedUntil?.toISOString() ?? null,
    busy,
  };
}

/**
 * Run one batch and, if more work remains, schedule the next batch to run in the
 * background after this response is sent. Work therefore continues even when the
 * user closes the dashboard.
 */
export async function runBatchAndContinue(sourceId: string, requestOrigin: string | null) {
  const result = await processSource(sourceId);
  const { source } = result;
  // Continue unless another worker holds the lock (it will schedule the next batch itself).
  const active = source.status === "PROCESSING" || source.status === "PENDING";
  const pauseMs = source.pausedUntil ? Math.max(0, source.pausedUntil.getTime() - Date.now()) : 0;
  // Long pauses (daily quota) are picked up by the cron / dashboard instead of a 24h self-ping chain.
  if (active && result.reason !== "locked" && pauseMs < 5 * 60_000) {
    const delayMs = pauseMs + 500;
    const origin = requestOrigin ?? appUrl();
    after(async () => {
      await new Promise((r) => setTimeout(r, Math.min(delayMs, 25_000)));
      try {
        await fetch(`${origin}/api/sources/${sourceId}/process`, {
          method: "POST",
          headers: { "x-internal-token": await internalToken(sourceId) },
        });
      } catch (e) {
        console.warn("[worker] failed to schedule next batch", e);
      }
    });
  }
  return result;
}
