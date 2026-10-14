import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthCard } from "@/components/app/auth/auth-card";
import { LoginForm } from "@/components/app/auth/login-form";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUser, safeNext } from "@/server/auth/dal";
import { ownerNeedsSetup } from "@/server/auth/owner";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <AuthCard title="Sign in" description="Use the owner account of this workspace.">
      <Suspense fallback={<FormSkeleton />}>
        <Login searchParams={searchParams} />
      </Suspense>
    </AuthCard>
  );
}

async function Login({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const sp = await searchParams;
  const next = safeNext(Array.isArray(sp.next) ? sp.next[0] : sp.next);
  if (await ownerNeedsSetup()) redirect("/setup");
  if (await getCurrentUser()) redirect(next);
  return <LoginForm next={next} />;
}

function FormSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-9 w-full" />
    </div>
  );
}
