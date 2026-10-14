"use client";

import { ShieldCheck } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type AuthFormState, setupOwnerAction } from "@/server/actions/auth";

export function SetupForm({ minLength }: { minLength: number }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(setupOwnerAction, {});
  return (
    <form action={action} className="space-y-4">
      <div>
        <Label htmlFor="setup-name" className="mb-1.5">Your name</Label>
        <Input id="setup-name" name="name" autoComplete="name" required defaultValue={state.name} />
      </div>
      <div>
        <Label htmlFor="setup-email" className="mb-1.5">Email</Label>
        <Input id="setup-email" name="email" type="email" autoComplete="username" required defaultValue={state.email} />
      </div>
      <div>
        <Label htmlFor="setup-password" className="mb-1.5">Password</Label>
        <Input id="setup-password" name="password" type="password" autoComplete="new-password" minLength={minLength} required aria-describedby="setup-password-hint" />
        <p id="setup-password-hint" className="mt-1 text-xs text-muted-foreground">At least {minLength} characters.</p>
      </div>
      <div>
        <Label htmlFor="setup-confirm" className="mb-1.5">Repeat password</Label>
        <Input id="setup-confirm" name="confirm" type="password" autoComplete="new-password" minLength={minLength} required />
      </div>
      {state.error && (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {state.error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        <ShieldCheck />
        {pending ? "Saving…" : "Create owner account"}
      </Button>
    </form>
  );
}
