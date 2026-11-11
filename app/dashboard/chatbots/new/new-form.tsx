"use client";

import { useActionState } from "react";
import { Alert, Button, Card, Field, Input, Textarea } from "@/components/ui";
import { createChatbot, type ActionState } from "@/lib/actions/chatbots";

export function NewChatbotForm() {
  const [state, action, pending] = useActionState(createChatbot, {} as ActionState);
  return (
    <Card>
      <form action={action} className="flex flex-col gap-5">
        <Field label="Chatbot name" htmlFor="name" hint="Shown to visitors as the assistant name (you can change it later).">
          <Input id="name" name="name" required minLength={2} maxLength={80} placeholder="Acme Support Bot" />
        </Field>
        <Field label="Website URL" htmlFor="websiteUrl" hint="Optional. The domain is automatically added to the authorized-domains list.">
          <Input id="websiteUrl" name="websiteUrl" type="url" placeholder="https://www.example.com" />
        </Field>
        <Field label="Description" htmlFor="description">
          <Textarea id="description" name="description" maxLength={500} placeholder="What is this chatbot for?" className="min-h-[72px]" />
        </Field>
        {state.error && <Alert>{state.error}</Alert>}
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create chatbot"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
