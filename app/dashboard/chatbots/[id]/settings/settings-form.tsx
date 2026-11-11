"use client";

import type { Chatbot } from "@prisma/client";
import { useActionState, useEffect, useState, useTransition } from "react";
import { Alert, Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { deleteChatbot, generatePromptFromWebsite, rotatePublicKey, updateChatbotSettings, type ActionState } from "@/lib/actions/chatbots";

type Props = { chatbot: Chatbot; defaultModel: string };

function Toggle({ name, label, hint, defaultChecked }: { name: string; label: string; hint?: string; defaultChecked: boolean }) {
  return (
    <label className="flex items-start gap-3 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500" />
      <span>
        <span className="font-medium text-zinc-800 dark:text-zinc-200">{label}</span>
        {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
      </span>
    </label>
  );
}

function AvatarPreview({ initial, color }: { initial: string; color: string }) {
  const [url, setUrl] = useState(initial);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    const onChange = (e: Event) => {
      setUrl((e as CustomEvent<string>).detail);
      setBroken(false);
    };
    window.addEventListener("avatar-preview", onChange);
    return () => window.removeEventListener("avatar-preview", onChange);
  }, []);
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-bold text-white" style={{ background: color }} title="Preview">
      {url && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" onError={() => setBroken(true)} />
      ) : (
        "AI"
      )}
    </div>
  );
}

function GeneratePromptButton({ chatbotId }: { chatbotId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await generatePromptFromWebsite(chatbotId);
            if (r.prompt) {
              const el = document.getElementById("systemPrompt") as HTMLTextAreaElement | null;
              if (el) el.value = r.prompt;
            } else setError(r.error ?? "Failed");
          })
        }
      >
        {pending ? "Generating…" : "Generate professional prompt from website"}
      </Button>
      <span className="text-xs text-zinc-500">Fills the box above from your indexed content — review, edit, then Save.</span>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

export function SettingsForm({ chatbot: bot, defaultModel }: Props) {
  const [state, action, pending] = useActionState(updateChatbotSettings.bind(null, bot.id), {} as ActionState);
  const [busy, startTransition] = useTransition();

  return (
    <form action={action} className="grid gap-6 lg:grid-cols-2">
      <Card title="General">
        <div className="flex flex-col gap-4">
          <Field label="Chatbot name" htmlFor="name"><Input id="name" name="name" required defaultValue={bot.name} /></Field>
          <Field label="Website URL" htmlFor="websiteUrl"><Input id="websiteUrl" name="websiteUrl" type="url" defaultValue={bot.websiteUrl ?? ""} /></Field>
          <Field label="Description" htmlFor="description"><Textarea id="description" name="description" defaultValue={bot.description ?? ""} className="min-h-[64px]" /></Field>
          <Toggle name="active" label="Active" hint="When paused, the widget stops responding on your site." defaultChecked={bot.active} />
        </div>
      </Card>

      <Card title="AI & prompt">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Model" htmlFor="model" hint={`Empty = server default (${defaultModel})`}>
              <Input id="model" name="model" list="model-suggestions" defaultValue={bot.model} placeholder={defaultModel} />
              <datalist id="model-suggestions">
                <option value="gemini-3.5-flash-lite" />
                <option value="gemini-flash-lite-latest" />
                <option value="gemini-3.6-flash" />
                <option value="gpt-4o-mini" />
                <option value="gpt-4.1-mini" />
                <option value="gpt-4o" />
                <option value="llama-3.3-70b-versatile" />
              </datalist>
            </Field>
            <Field label="Temperature" htmlFor="temperature"><Input id="temperature" name="temperature" type="number" step="0.1" min={0} max={1} defaultValue={bot.temperature} /></Field>
          </div>
          <Field label="System prompt (persona)" htmlFor="systemPrompt" hint="Who the assistant is and how it speaks. Business answers always come from your knowledge base.">
            <Textarea id="systemPrompt" name="systemPrompt" required defaultValue={bot.systemPrompt} className="min-h-[140px]" />
            <GeneratePromptButton chatbotId={bot.id} />
          </Field>
          <Field
            label="Training — how to answer (your rules)"
            htmlFor="responseGuidelines"
            hint="Write rules in any language. Examples: “Pricing poochein to exact price na do, WhatsApp par free quote ke liye bhejo.” · “Always ask the subject and deadline before suggesting a service.” · “Mention the 50% first-session discount when someone asks about cost.” · “Never promise grades or guarantees.”"
          >
            <Textarea id="responseGuidelines" name="responseGuidelines" defaultValue={bot.responseGuidelines} maxLength={4000} className="min-h-[140px]" placeholder={"- When a visitor asks about price, explain pricing depends on subject & deadline and offer a free quote on WhatsApp.\n- Always ask which subject/exam and the deadline if not mentioned.\n- Keep replies under 5 lines unless listing services.\n- For complaints, apologize and offer a human callback."} />
          </Field>
          <p className="text-xs text-zinc-500">
            For exact answers to specific questions, add them under <strong>Knowledge → FAQs</strong> — the bot uses them word-for-word.
          </p>
          <Field label="Welcome message" htmlFor="welcomeMessage"><Input id="welcomeMessage" name="welcomeMessage" required defaultValue={bot.welcomeMessage} /></Field>
          <Field label="Fallback message" htmlFor="fallbackMessage" hint="Shown when a business question can't be answered from your content."><Input id="fallbackMessage" name="fallbackMessage" required defaultValue={bot.fallbackMessage} /></Field>
          <Toggle name="allowGeneralAnswers" label="Answer general questions too" hint="Off-topic questions get a short professional answer instead of a refusal. Business questions always use your content." defaultChecked={bot.allowGeneralAnswers} />
          <Toggle name="showSources" label="Show source links under answers" hint="Off = answers are pure text with no page links." defaultChecked={bot.showSources} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Similarity cutoff" htmlFor="similarityCutoff" hint="0–0.9. Higher = stricter matching."><Input id="similarityCutoff" name="similarityCutoff" type="number" step="0.05" min={0} max={0.9} defaultValue={bot.similarityCutoff} /></Field>
            <Field label="Context chunks" htmlFor="maxContextChunks" hint="How many passages to feed the model."><Input id="maxContextChunks" name="maxContextChunks" type="number" min={1} max={12} defaultValue={bot.maxContextChunks} /></Field>
          </div>
        </div>
      </Card>

      <Card title="Branding">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Assistant display name" htmlFor="botName"><Input id="botName" name="botName" required defaultValue={bot.botName} /></Field>
            <Field label="Primary color" htmlFor="primaryColor">
              <div className="flex gap-2">
                <input type="color" defaultValue={bot.primaryColor} onChange={(e) => ((document.getElementById("primaryColor") as HTMLInputElement).value = e.target.value)} className="h-10 w-12 cursor-pointer rounded border border-zinc-300" aria-label="Pick color" />
                <Input id="primaryColor" name="primaryColor" required pattern="^#[0-9a-fA-F]{6}$" defaultValue={bot.primaryColor} />
              </div>
            </Field>
            <Field label="Position" htmlFor="position">
              <Select id="position" name="position" defaultValue={bot.position}>
                <option value="right">Bottom right</option>
                <option value="left">Bottom left</option>
              </Select>
            </Field>
            <Field label="Launcher text" htmlFor="launcherText" hint="Optional label next to the chat icon."><Input id="launcherText" name="launcherText" maxLength={30} defaultValue={bot.launcherText ?? ""} /></Field>
          </div>
          <Field label="Avatar / icon image URL" htmlFor="avatarUrl" hint="Shown as the chat bubble icon and in the chat header. Use a square PNG/JPG (e.g. your logo).">
            <div className="flex items-center gap-3">
              <AvatarPreview initial={bot.avatarUrl ?? ""} color={bot.primaryColor} />
              <Input id="avatarUrl" name="avatarUrl" type="url" defaultValue={bot.avatarUrl ?? ""} placeholder="https://example.com/logo.png" onChange={(e) => window.dispatchEvent(new CustomEvent("avatar-preview", { detail: e.target.value }))} />
            </div>
          </Field>
          <div className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-start">
            <Toggle name="poweredByLabel" label="Show footer label" defaultChecked={bot.poweredByLabel} />
            <Field label="Footer label text" htmlFor="poweredByText" hint="Your own branding, e.g. “Powered by Hire Class Buddy”.">
              <Input id="poweredByText" name="poweredByText" maxLength={60} defaultValue={bot.poweredByText} />
            </Field>
          </div>
        </div>
      </Card>

      <Card title="Support & handoff">
        <div className="flex flex-col gap-4">
          <Toggle name="handoffEnabled" label="Offer human handoff" hint="When the bot can't answer, visitors can leave their email or open your support link." defaultChecked={bot.handoffEnabled} />
          <Field label="Support email" htmlFor="supportEmail"><Input id="supportEmail" name="supportEmail" type="email" defaultValue={bot.supportEmail ?? ""} placeholder="support@example.com" /></Field>
          <Field label="Support / contact URL" htmlFor="supportUrl"><Input id="supportUrl" name="supportUrl" type="url" defaultValue={bot.supportUrl ?? ""} placeholder="https://example.com/contact" /></Field>
        </div>
      </Card>

      <Card title="Security & limits" className="lg:col-span-2">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Authorized domains" htmlFor="allowedDomains" hint="One per line. Supports wildcards like *.example.com. Leave empty to allow any site (not recommended).">
            <Textarea id="allowedDomains" name="allowedDomains" defaultValue={bot.allowedDomains.join("\n")} placeholder={"example.com\n*.example.com\nlocalhost"} className="min-h-[110px] font-mono text-xs" />
          </Field>
          <Field label="Monthly message limit" htmlFor="monthlyMessageLimit" hint="0 = unlimited. Set a number to cap your AI usage."><Input id="monthlyMessageLimit" name="monthlyMessageLimit" type="number" min={0} defaultValue={bot.monthlyMessageLimit} /></Field>
          <Field label="Messages per visitor per minute" htmlFor="rateLimitPerMinute" hint="0 = unlimited. Protects against spam bots."><Input id="rateLimitPerMinute" name="rateLimitPerMinute" type="number" min={0} max={600} defaultValue={bot.rateLimitPerMinute} /></Field>
        </div>
      </Card>

      <Card title="Data retention" description="Keeps the database small. Usage stats, handoff leads (and their conversations) and the unanswered-questions log are always kept." className="lg:col-span-2">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Keep conversations for" htmlFor="retentionDays">
            <Select id="retentionDays" name="retentionDays" defaultValue={String(bot.retentionDays)}>
              <option value="7">7 days (recommended)</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="0">Forever</option>
            </Select>
          </Field>
          <div className="md:col-span-2 text-sm text-zinc-500">
            A cleanup job runs every night at 02:00 UTC and deletes conversations whose last message is older than this. You can also run it manually from the Overview tab.
            {bot.lastCleanupAt && <span className="block">Last cleanup: {new Date(bot.lastCleanupAt).toLocaleString()}</span>}
          </div>
        </div>
      </Card>

      <div className="flex flex-col gap-3 lg:col-span-2">
        {state.error && <Alert>{state.error}</Alert>}
        {state.success && <Alert tone="green">{state.success}</Alert>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                if (confirm("Rotate the public key? Existing embed snippets will stop working until updated.")) startTransition(() => rotatePublicKey(bot.id));
              }}
            >
              Rotate public key
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={busy}
              onClick={() => {
                if (confirm(`Delete "${bot.name}" permanently, including all knowledge and conversations?`)) startTransition(() => deleteChatbot(bot.id));
              }}
            >
              Delete chatbot
            </Button>
          </div>
          <Button type="submit" size="lg" disabled={pending}>{pending ? "Saving…" : "Save settings"}</Button>
        </div>
      </div>
    </form>
  );
}
