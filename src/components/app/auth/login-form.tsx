"use client";

import { LogIn } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type AuthFormState, loginAction } from "@/server/actions/auth";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(loginAction, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <Label htmlFor="login-email" className="mb-1.5">Email</Label>
        <Input id="login-email" name="email" type="email" autoComplete="username" required defaultValue={state.email} />
      </div>
      <div>
        <Label htmlFor="login-password" className="mb-1.5">Password</Label>
        <Input id="login-password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {state.error && (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {state.error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        <LogIn />
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
