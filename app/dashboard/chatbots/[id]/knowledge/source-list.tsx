"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Alert, Badge, Button, EmptyState, Field, Input } from "@/components/ui";
import { deleteSource, reindexSource, updateFaqSource, type SourceActionState } from "@/lib/actions/sources";
import { FaqFields } from "./add-source";

export type SourceRow = {
  id: string;
  type: "URL" | "FILE" | "FAQ" | "TEXT" | "GITHUB";
  name: string;
  url: string | null;
  status: "PENDING" | "PROCESSING" | "READY" | "FAILED";
  error: string | null;
  chunkCount: number;
  pageCount: number;
  charCount: number;
  createdAt: string;
  progress?: string | null;
  faqItems?: { question: string; answer: string }[];
  payload?: undefined;
};

const TYPE_LABEL: Record<SourceRow["type"], string> = { URL: "Website", FILE: "File", FAQ: "FAQ", TEXT: "Text", GITHUB: "GitHub" };
const STATUS_TONE: Record<SourceRow["status"], "gray" | "blue" | "green" | "red"> = { PENDING: "gray", PROCESSING: "blue", READY: "green", FAILED: "red" };

/**
 * Lists sources with live progress. Processing itself runs server-side in the background;
 * this component polls for status and nudges the worker (POST is idempotent thanks to the
 * DB lock) so work resumes even if a background continuation was lost.
 */
export function SourceList({ chatbotId, initial }: { chatbotId: string; initial: SourceRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const activeIds = rows.filter((r) => r.status === "PENDING" || r.status === "PROCESSING").map((r) => r.id).join(",");
  const tick = useRef(0);

  const [prevInitial, setPrevInitial] = useState(initial);
  if (prevInitial !== initial) {
    setPrevInitial(initial);
    setRows(initial);
  }

  useEffect(() => {
    if (!activeIds) return;
    let cancelled = false;
    const ids = activeIds.split(",");
    const poll = async () => {
      tick.current += 1;
      // Every 4th poll, nudge the worker; otherwise just read status.
      const method = tick.current % 4 === 0 ? "POST" : "GET";
      const updates = await Promise.all(
        ids.map(async (id) => {
          try {
            const res = await fetch(`/api/sources/${id}/process`, { method });
            return res.ok ? ((await res.json()) as Partial<SourceRow> & { id: string }) : null;
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      setRows((rs) => rs.map((r) => ({ ...r, ...(updates.find((u) => u?.id === r.id) ?? {}) })));
      if (updates.some((u) => u && u.status !== "PROCESSING" && u.status !== "PENDING")) router.refresh();
    };
    const timer = setInterval(poll, 3000);
    poll();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeIds, router]);

  if (rows.length === 0) return <EmptyState title="No sources yet" description="Add a website, upload documents or write FAQs using the panel." />;

  return (
    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
      {rows.map((s) => (
        <li key={s.id} className="py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{TYPE_LABEL[s.type]}</Badge>
                <span className="truncate font-medium text-zinc-900 dark:text-zinc-50">{s.name}</span>
                <Badge tone={STATUS_TONE[s.status]}>
                  {s.status === "PROCESSING" && <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-current" />}
                  {s.status.toLowerCase()}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                {s.url && (
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {s.url}
                  </a>
                )}
                {s.url && " · "}
                {s.chunkCount} chunks · {s.pageCount > 0 && `${s.pageCount} ${s.type === "FAQ" ? "questions" : s.type === "GITHUB" ? "files" : "pages"} · `}
                {(s.charCount / 1000).toFixed(1)}k chars · {new Date(s.createdAt).toLocaleDateString()}
              </p>
              {s.progress && (s.status === "PROCESSING" || s.status === "PENDING") && <p className="mt-1 text-xs text-indigo-600">{s.progress}</p>}
              {s.error && s.status === "FAILED" && <p className="mt-1 text-xs text-red-600">{s.error}</p>}
            </div>
            <div className="flex shrink-0 gap-1">
              {s.type === "FAQ" && (
                <Button size="sm" variant="ghost" onClick={() => setEditing(editing === s.id ? null : s.id)}>
                  {editing === s.id ? "Close" : "Edit"}
                </Button>
              )}
              {(s.type === "URL" || s.type === "GITHUB" || s.status === "FAILED") && s.status !== "PROCESSING" && s.status !== "PENDING" && (
                <Button size="sm" variant="ghost" onClick={() => startTransition(() => reindexSource(chatbotId, s.id))}>
                  Re-index
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="text-red-600"
                onClick={() => {
                  if (confirm(`Delete "${s.name}" and all its indexed content?`)) startTransition(() => deleteSource(chatbotId, s.id));
                }}
              >
                Delete
              </Button>
            </div>
          </div>
          {editing === s.id && s.type === "FAQ" && <FaqEditor chatbotId={chatbotId} source={s} onDone={() => setEditing(null)} />}
        </li>
      ))}
    </ul>
  );
}

function FaqEditor({ chatbotId, source, onDone }: { chatbotId: string; source: SourceRow; onDone: () => void }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(updateFaqSource.bind(null, chatbotId, source.id), {} as SourceActionState);
  useEffect(() => {
    if (state.success) {
      router.refresh();
      onDone();
    }
  }, [state, router, onDone]);
  return (
    <form action={action} className="mt-3 flex flex-col gap-3 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
      <Field label="Collection name" htmlFor={`faq-name-${source.id}`}>
        <Input id={`faq-name-${source.id}`} name="name" defaultValue={source.name} />
      </Field>
      <FaqFields initial={source.faqItems} />
      {state.error && <Alert>{state.error}</Alert>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onDone}>Cancel</Button>
        <Button type="submit" size="sm" disabled={pending}>{pending ? "Saving…" : "Save & re-index"}</Button>
      </div>
    </form>
  );
}
