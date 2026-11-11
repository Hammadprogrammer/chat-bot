"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui";

const tabs = [
  { href: "", label: "Overview" },
  { href: "/knowledge", label: "Knowledge" },
  { href: "/conversations", label: "Conversations" },
  { href: "/handoffs", label: "Handoffs" },
  { href: "/settings", label: "Settings" },
  { href: "/embed", label: "Embed" },
];

export function ChatbotTabs({ id }: { id: string }) {
  const pathname = usePathname();
  const base = `/dashboard/chatbots/${id}`;
  return (
    <nav className="-mb-2 flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800" aria-label="Chatbot sections">
      {tabs.map((t) => {
        const href = `${base}${t.href}`;
        const active = t.href === "" ? pathname === base : pathname.startsWith(href);
        return (
          <Link
            key={t.href}
            href={href}
            className={cn(
              "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition",
              active ? "border-indigo-600 text-indigo-600" : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-white",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
