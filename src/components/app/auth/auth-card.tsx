import { Clapperboard } from "lucide-react";
import type { ReactNode } from "react";

/** Centered card for the sign-in and setup screens (no app shell). */
export function AuthCard({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-white">
            <Clapperboard className="size-5" aria-hidden />
          </span>
          <div className="leading-tight">
            <p className="font-semibold">MediaFlow</p>
            <p className="text-xs text-muted-foreground">AI content studio</p>
          </div>
        </div>
        <section className="rounded-2xl border bg-card p-6 shadow-card">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          <div className="mt-6">{children}</div>
        </section>
      </div>
    </main>
  );
}
