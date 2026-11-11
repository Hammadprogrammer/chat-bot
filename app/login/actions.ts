"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { authenticate, registerUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/rate-limit";
import { createSession, deleteSession } from "@/lib/session";
import { headers } from "next/headers";

const LoginSchema = z.object({
  email: z.string().trim().min(1, "Email is required").max(254),
  password: z.string().min(1, "Password is required").max(200),
});

const RegisterSchema = LoginSchema.extend({
  name: z.string().trim().max(120).optional(),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

export type AuthState = { error?: string; email?: string; name?: string };

async function ipKey(prefix: string) {
  const h = await headers();
  return `${prefix}:${(h.get("x-forwarded-for") ?? "local").split(",")[0].trim()}`;
}

export async function login(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "");
  const parsed = LoginSchema.safeParse({ email, password: formData.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message, email };
  if (!rateLimit(await ipKey("login"), 10, 15 * 60_000).ok) return { error: "Too many attempts. Try again in a few minutes.", email };

  const user = await authenticate(parsed.data.email, parsed.data.password);
  if (!user) return { error: "Invalid email or password", email };

  await createSession(user);
  redirect("/dashboard");
}

export async function register(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "");
  const name = String(formData.get("name") ?? "");
  if (env().ALLOW_SIGNUP !== "true") return { error: "Sign-up is disabled", email, name };
  const parsed = RegisterSchema.safeParse({ email, name, password: formData.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message, email, name };
  if (!rateLimit(await ipKey("register"), 5, 60 * 60_000).ok) return { error: "Too many attempts. Try again later.", email, name };

  const user = await registerUser(parsed.data.email, parsed.data.password, parsed.data.name || undefined);
  if (!user) return { error: "An account with this email already exists", email, name };

  await createSession(user);
  redirect("/dashboard");
}

export async function logout() {
  await deleteSession();
  redirect("/login");
}
