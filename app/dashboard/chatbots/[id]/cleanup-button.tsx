"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { runCleanupNow } from "@/lib/actions/chatbots";

export function CleanupButton({ chatbotId, retentionDays }: { chatbotId: string; retentionDays: number }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending || retentionDays === 0}
        onClick={() =>
          start(async () => {
            const r = await runCleanupNow(chatbotId);
            setMsg(`Deleted ${r.conversationsDeleted} conversations (${r.messagesDeleted} messages).`);
          })
        }
      >
        {pending ? "Cleaning…" : "Clean up now"}
      </Button>
      {retentionDays === 0 && <span className="text-xs text-zinc-500">Retention is set to “Forever” in Settings.</span>}
      {msg && <span className="text-xs text-emerald-600">{msg}</span>}
    </div>
  );
}
