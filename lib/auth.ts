import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { cache } from "react";
import { env } from "./env";
import { prisma } from "./prisma";
import { getSession } from "./session";

const BCRYPT_ROUNDS = 10;

export async function hashPassword(password: string) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * Authenticate with email + password. If the credentials match the ADMIN_EMAIL /
 * ADMIN_PASSWORD env vars, the admin account is created on first login (bootstrap).
 */
export async function authenticate(email: string, password: string) {
  const normalized = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalized } });
  if (user) {
    return (await bcrypt.compare(password, user.passwordHash)) ? user : null;
  }

  const { ADMIN_EMAIL, ADMIN_PASSWORD } = env();
  if (ADMIN_EMAIL && ADMIN_PASSWORD && normalized === ADMIN_EMAIL.toLowerCase() && password === ADMIN_PASSWORD) {
    return prisma.user.create({
      data: { email: normalized, name: "Admin", passwordHash: await hashPassword(password), role: "ADMIN" },
    });
  }
  return null;
}

export async function registerUser(email: string, password: string, name?: string) {
  const normalized = email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email: normalized } });
  if (existing) return null;
  return prisma.user.create({ data: { email: normalized, name, passwordHash: await hashPassword(password) } });
}

export const getCurrentUser = cache(async () => {
  const session = await getSession();
  if (!session) return null;
  return prisma.user.findUnique({ where: { id: session.userId }, select: { id: true, email: true, name: true, role: true } });
});

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Load a chatbot and assert that it belongs to the current user (tenant isolation). */
export async function requireChatbot(chatbotId: string) {
  const user = await requireUser();
  const chatbot = await prisma.chatbot.findFirst({ where: { id: chatbotId, userId: user.id } });
  if (!chatbot) redirect("/dashboard");
  return { user, chatbot };
}
