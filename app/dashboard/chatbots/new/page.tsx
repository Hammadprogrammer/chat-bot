import type { Metadata } from "next";
import { NewChatbotForm } from "./new-form";

export const metadata: Metadata = { title: "New chatbot" };

export default function NewChatbotPage() {
  return (
    <div className="mx-auto w-full max-w-xl">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">Create a chatbot</h1>
      <p className="mb-6 text-sm text-zinc-500">You can add knowledge sources and customize branding in the next step.</p>
      <NewChatbotForm />
    </div>
  );
}
