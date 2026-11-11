"use client";

import { useActionState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { login, register, type AuthState } from "./actions";

const initialState: AuthState = {};

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const [state, formAction, pending] = useActionState(mode === "login" ? login : register, initialState);

  return (
    <form action={formAction} className="flex w-full flex-col gap-5">
      {mode === "register" && (
        <Field label="Name" htmlFor="name">
          <Input id="name" name="name" autoComplete="name" defaultValue={state.name} />
        </Field>
      )}
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="text" autoComplete="username" required defaultValue={state.email} />
      </Field>
      <Field label="Password" htmlFor="password" hint={mode === "register" ? "At least 8 characters" : undefined}>
        <Input id="password" name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required />
      </Field>
      {state.error && <Alert>{state.error}</Alert>}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
      </Button>
    </form>
  );
}
