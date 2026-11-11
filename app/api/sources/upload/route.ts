import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { ExtractError, extractFromFile, isSupportedFile, MAX_FILE_BYTES, SUPPORTED_EXTENSIONS } from "@/lib/ingest/extract";
import { runBatchAndContinue, serializeSource } from "@/lib/ingest/worker";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const chatbotId = form?.get("chatbotId");
  const file = form?.get("file");
  if (!form || typeof chatbotId !== "string" || !(file instanceof File)) {
    return NextResponse.json({ error: "chatbotId and file are required" }, { status: 400 });
  }
  const chatbot = await prisma.chatbot.findFirst({ where: { id: chatbotId, userId: user.id }, select: { id: true } });
  if (!chatbot) return NextResponse.json({ error: "Chatbot not found" }, { status: 404 });

  if (!isSupportedFile(file.name)) {
    return NextResponse.json({ error: `Unsupported file type. Allowed: ${SUPPORTED_EXTENSIONS.join(", ")}` }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "File exceeds the 10 MB limit" }, { status: 413 });

  try {
    const { text, pages } = await extractFromFile(Buffer.from(await file.arrayBuffer()), file.name);
    if (text.length < 20) return NextResponse.json({ error: "No readable text found in this file" }, { status: 422 });
    const source = await prisma.knowledgeSource.create({
      data: { chatbotId: chatbot.id, type: "FILE", name: file.name, pageCount: pages, payload: { text, title: file.name } },
    });
    const { source: processed, busy } = await runBatchAndContinue(source.id, new URL(req.url).origin);
    return NextResponse.json(serializeSource(processed, busy));
  } catch (e) {
    if (e instanceof ExtractError) return NextResponse.json({ error: e.message }, { status: 422 });
    console.error(e);
    return NextResponse.json({ error: "Failed to process file" }, { status: 500 });
  }
}
