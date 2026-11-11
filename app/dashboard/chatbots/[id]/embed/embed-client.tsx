"use client";

import { useEffect, useState } from "react";
import { Button, Card, cn } from "@/components/ui";

type Platform = "html" | "wordpress" | "nextjs" | "react";

function snippets(base: string, key: string): Record<Platform, { title: string; steps: string; code: string }> {
  const tag = `<script src="${base}/widget.js" data-chatbot-key="${key}" async></script>`;
  return {
    html: {
      title: "Static HTML / any website",
      steps: "Paste this just before the closing </body> tag on every page where you want the chat bubble.",
      code: tag,
    },
    wordpress: {
      title: "WordPress",
      steps: "Appearance → Theme File Editor → footer.php (before </body>), or use a plugin like “WPCode” / “Insert Headers and Footers” and paste the snippet into the footer scripts box. Works with Elementor, Divi and WooCommerce themes.",
      code: tag,
    },
    nextjs: {
      title: "Next.js (App Router)",
      steps: "Add the Script component to app/layout.tsx so the widget loads on every route.",
      code: `import Script from "next/script";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Script
          src="${base}/widget.js"
          data-chatbot-key="${key}"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}`,
    },
    react: {
      title: "React / Vite / Vue / Angular",
      steps: "Add the script tag to your public index.html, or inject it at runtime once the app mounts.",
      code: `useEffect(() => {
  const s = document.createElement("script");
  s.src = "${base}/widget.js";
  s.async = true;
  s.dataset.chatbotKey = "${key}";
  document.body.appendChild(s);
  return () => s.remove();
}, []);`,
    },
  };
}

export function EmbedSnippets({ baseUrl, publicKey }: { baseUrl: string; publicKey: string }) {
  const [platform, setPlatform] = useState<Platform>("html");
  const [copied, setCopied] = useState(false);
  const all = snippets(baseUrl, publicKey);
  const current = all[platform];

  async function copy() {
    await navigator.clipboard.writeText(current.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Card title="Install the widget" description="One script tag. The widget is isolated in a shadow DOM so it never conflicts with your site's CSS.">
      <div className="mb-4 flex flex-wrap gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900">
        {(Object.keys(all) as Platform[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPlatform(p)}
            className={cn("rounded-md px-3 py-1.5 text-xs font-medium transition", platform === p ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-white" : "text-zinc-500 hover:text-zinc-900 dark:hover:text-white")}
          >
            {all[p].title.split(" ")[0].replace("/", "")}
          </button>
        ))}
      </div>
      <h3 className="font-medium text-zinc-900 dark:text-zinc-50">{current.title}</h3>
      <p className="mb-3 text-sm text-zinc-500">{current.steps}</p>
      <div className="relative">
        <pre className="overflow-x-auto rounded-lg bg-zinc-950 p-4 text-xs leading-relaxed text-zinc-100">
          <code>{current.code}</code>
        </pre>
        <Button size="sm" variant="secondary" className="absolute right-2 top-2" onClick={copy}>
          {copied ? "Copied!" : "Copy"}
        </Button>
      </div>
      <div className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <p className="font-medium">Programmatic control</p>
          <code className="mt-1 block text-xs text-zinc-500">window.MSChatbot.open() / .close() / .toggle()</code>
        </div>
        <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <p className="font-medium">Public key</p>
          <code className="mt-1 block break-all text-xs text-zinc-500">{publicKey}</code>
        </div>
      </div>
    </Card>
  );
}

export function WidgetPreview({ baseUrl, publicKey }: { baseUrl: string; publicKey: string }) {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const s = document.createElement("script");
    s.src = `${window.location.origin}/widget.js?v=${Date.now()}`;
    s.async = true;
    s.dataset.chatbotKey = publicKey;
    s.dataset.apiBase = window.location.origin;
    document.body.appendChild(s);
    return () => {
      s.remove();
      document.getElementById("ms-chatbot-host")?.remove();
      delete (window as unknown as { __msChatbotLoaded?: boolean }).__msChatbotLoaded;
    };
  }, [enabled, publicKey, baseUrl]);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-zinc-500">
        Loads the widget on this page using your current settings and knowledge base. Chats from the preview are saved as real conversations.
      </p>
      <Button variant={enabled ? "secondary" : "primary"} onClick={() => setEnabled((v) => !v)}>
        {enabled ? "Hide preview widget" : "Launch preview widget"}
      </Button>
      {enabled && <p className="text-xs text-zinc-500">Look for the chat bubble in the corner of this page.</p>}
    </div>
  );
}
