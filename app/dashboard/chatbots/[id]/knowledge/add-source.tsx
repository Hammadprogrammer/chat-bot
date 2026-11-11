"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { Alert, Button, Card, cn, Field, Input, Select, Textarea } from "@/components/ui";
import { addFaqSource, addGitHubSource, addTextSource, addUrlSource, type SourceActionState } from "@/lib/actions/sources";

type Tab = "url" | "file" | "faq" | "text" | "github";
const TABS: { id: Tab; label: string }[] = [
  { id: "url", label: "Website" },
  { id: "file", label: "Files" },
  { id: "faq", label: "FAQs" },
  { id: "text", label: "Text" },
  { id: "github", label: "GitHub" },
];

export function AddSourcePanel({ chatbotId }: { chatbotId: string }) {
  const [tab, setTab] = useState<Tab>("url");
  return (
    <Card title="Add knowledge" description="Content is extracted, chunked and embedded automatically.">
      <div className="mb-4 flex flex-wrap gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn("flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition", tab === t.id ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-white" : "text-zinc-500 hover:text-zinc-900 dark:hover:text-white")}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "url" && <UrlForm chatbotId={chatbotId} />}
      {tab === "file" && <FileForm chatbotId={chatbotId} />}
      {tab === "faq" && <FaqForm chatbotId={chatbotId} />}
      {tab === "text" && <TextForm chatbotId={chatbotId} />}
      {tab === "github" && <GitHubForm chatbotId={chatbotId} />}
    </Card>
  );
}

function useSourceAction(action: (prev: SourceActionState, fd: FormData) => Promise<SourceActionState>) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(action, {} as SourceActionState);
  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
      router.refresh();
    }
  }, [state, router]);
  return { state, formAction, pending, formRef };
}

function Feedback({ state }: { state: SourceActionState }) {
  if (state.error) return <Alert>{state.error}</Alert>;
  if (state.success) return <Alert tone="green">{state.success}</Alert>;
  return null;
}

function UrlForm({ chatbotId }: { chatbotId: string }) {
  const { state, formAction, pending, formRef } = useSourceAction(addUrlSource.bind(null, chatbotId));
  const [mode, setMode] = useState("crawl");
  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4">
      <Field label="Page or website URL" htmlFor="url">
        <Input id="url" name="url" type="url" required placeholder="https://www.example.com" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Mode" htmlFor="mode">
          <Select id="mode" name="mode" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="crawl">Crawl whole site</option>
            <option value="single">Single page only</option>
          </Select>
        </Field>
        <Field label="Max pages" htmlFor="maxPages">
          <Input id="maxPages" name="maxPages" type="number" min={1} max={150} defaultValue={50} disabled={mode === "single"} />
        </Field>
      </div>
      <p className="text-xs text-zinc-500">
        Just add the URL — crawling, retries and rate limits are handled automatically in the background. You can close this page; progress is saved.
      </p>
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Adding…" : "Add website"}</Button>
    </form>
  );
}

function FileForm({ chatbotId }: { chatbotId: string }) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload() {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    for (const file of files) {
      setProgress((p) => ({ ...p, [file.name]: "Uploading…" }));
      const fd = new FormData();
      fd.append("chatbotId", chatbotId);
      fd.append("file", file);
      try {
        const res = await fetch("/api/sources/upload", { method: "POST", body: fd });
        const data = await res.json();
        setProgress((p) => ({ ...p, [file.name]: res.ok ? (data.status === "READY" ? "Indexed" : data.error ?? data.status) : `Failed: ${data.error}` }));
      } catch {
        setProgress((p) => ({ ...p, [file.name]: "Failed: network error" }));
      }
    }
    setBusy(false);
    setFiles([]);
    if (inputRef.current) inputRef.current.value = "";
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <Field label="Documents" htmlFor="file" hint="PDF, DOCX, TXT, Markdown, CSV, HTML or JSON · up to 10 MB each">
        <input
          ref={inputRef}
          id="file"
          type="file"
          multiple
          accept=".pdf,.docx,.txt,.md,.markdown,.csv,.html,.htm,.json"
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          className="block w-full text-sm text-zinc-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-100 dark:text-zinc-300 dark:file:bg-indigo-950 dark:file:text-indigo-300"
        />
      </Field>
      {Object.keys(progress).length > 0 && (
        <ul className="space-y-1 text-xs">
          {Object.entries(progress).map(([name, status]) => (
            <li key={name} className="flex justify-between gap-2">
              <span className="truncate">{name}</span>
              <span className={status.startsWith("Failed") ? "text-red-600" : "text-zinc-500"}>{status}</span>
            </li>
          ))}
        </ul>
      )}
      {error && <Alert>{error}</Alert>}
      <Button type="button" onClick={upload} disabled={busy || files.length === 0}>
        {busy ? "Processing…" : `Upload ${files.length || ""} file${files.length === 1 ? "" : "s"}`}
      </Button>
    </div>
  );
}

export function FaqFields({ initial }: { initial?: { question: string; answer: string }[] }) {
  const [rows, setRows] = useState(initial && initial.length ? initial : [{ question: "", answer: "" }]);
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row, i) => (
        <div key={i} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-500">Q{i + 1}</span>
            {rows.length > 1 && (
              <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                Remove
              </button>
            )}
          </div>
          <Input name="question" placeholder="Question" required defaultValue={row.question} className="mb-2" />
          <Textarea name="answer" placeholder="Answer" required defaultValue={row.answer} className="min-h-[64px]" />
        </div>
      ))}
      <button type="button" className="self-start text-sm font-medium text-indigo-600 hover:underline" onClick={() => setRows([...rows, { question: "", answer: "" }])}>
        + Add another question
      </button>
    </div>
  );
}

function FaqForm({ chatbotId }: { chatbotId: string }) {
  const { state, formAction, pending, formRef } = useSourceAction(addFaqSource.bind(null, chatbotId));
  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4">
      <Field label="Collection name" htmlFor="faq-name">
        <Input id="faq-name" name="name" placeholder="General FAQs" defaultValue="FAQs" />
      </Field>
      <FaqFields />
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Indexing…" : "Save FAQs"}</Button>
    </form>
  );
}

function TextForm({ chatbotId }: { chatbotId: string }) {
  const { state, formAction, pending, formRef } = useSourceAction(addTextSource.bind(null, chatbotId));
  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4">
      <Field label="Title" htmlFor="text-title">
        <Input id="text-title" name="title" required placeholder="Return policy" />
      </Field>
      <Field label="Content" htmlFor="text-body">
        <Textarea id="text-body" name="text" required minLength={20} className="min-h-[180px]" placeholder="Paste any text the assistant should know…" />
      </Field>
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Indexing…" : "Add text"}</Button>
    </form>
  );
}

function GitHubForm({ chatbotId }: { chatbotId: string }) {
  const { state, formAction, pending, formRef } = useSourceAction(addGitHubSource.bind(null, chatbotId));
  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4">
      <Field label="Repository URL" htmlFor="gh-url" hint="Imports Markdown/text/docs files from a public repository (set GITHUB_TOKEN for private repos and higher limits).">
        <Input id="gh-url" name="url" required placeholder="https://github.com/owner/repo" />
      </Field>
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Scanning…" : "Import repository"}</Button>
    </form>
  );
}
