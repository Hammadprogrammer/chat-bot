import type { Metadata } from "next";
import { Alert, Card } from "@/components/ui";
import { requireChatbot } from "@/lib/auth";
import { appUrl } from "@/lib/env";
import { EmbedSnippets, WidgetPreview } from "./embed-client";

export const metadata: Metadata = { title: "Embed" };

export default async function EmbedPage({ params }: PageProps<"/dashboard/chatbots/[id]/embed">) {
  const { id } = await params;
  const { chatbot } = await requireChatbot(id);
  const base = appUrl();

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="flex flex-col gap-6 lg:col-span-3">
        {chatbot.allowedDomains.length === 0 && (
          <Alert tone="yellow">No authorized domains are set — the widget will work on any site. Add your domains in Settings → Security.</Alert>
        )}
        <EmbedSnippets baseUrl={base} publicKey={chatbot.publicKey} />
      </div>
      <Card className="lg:col-span-2" title="Live preview" description="This is the real widget, loaded from this app.">
        <WidgetPreview baseUrl={base} publicKey={chatbot.publicKey} />
      </Card>
    </div>
  );
}
