import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { env } from "@/lib/env";
import { AuthForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  const allowSignup = env().ALLOW_SIGNUP === "true";
  return (
    <AuthShell title="Welcome back" subtitle="Sign in to manage your chatbots.">
      <AuthForm mode="login" />
      {allowSignup && (
        <p className="mt-6 text-center text-sm text-zinc-500">
          No account?{" "}
          <Link href="/register" className="font-medium text-indigo-600 hover:underline">
            Create one
          </Link>
        </p>
      )}
    </AuthShell>
  );
}
