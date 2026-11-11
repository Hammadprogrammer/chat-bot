import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { AuthForm } from "@/app/login/login-form";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "Create account" };

export default function RegisterPage() {
  if (env().ALLOW_SIGNUP !== "true") notFound();
  return (
    <AuthShell title="Create your account" subtitle="Start building AI chatbots for your websites.">
      <AuthForm mode="register" />
      <p className="mt-6 text-center text-sm text-zinc-500">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-indigo-600 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
