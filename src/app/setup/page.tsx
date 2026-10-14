import type { Metadata } from "next";
import { io } from "next/cache";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthCard } from "@/components/app/auth/auth-card";
import { SetupForm } from "@/components/app/auth/setup-form";
import { Skeleton } from "@/components/ui/skeleton";
import { ownerNeedsSetup } from "@/server/auth/owner";
import { MIN_PASSWORD_LENGTH } from "@/server/auth/password";

export const metadata: Metadata = { title: "Set up" };

/** First run only: creates the owner's password. Closed once an owner can sign in. */
export default function SetupPage() {
  return (
    <AuthCard title="Set up your workspace" description="Create the owner account. It's the only account for now, and you'll use it to sign in.">
      <Suspense fallback={<Skeleton className="h-72 w-full" />}>
        <Setup />
      </Suspense>
    </AuthCard>
  );
}

async function Setup() {
  await io();
  if (!(await ownerNeedsSetup())) redirect("/login");
  return <SetupForm minLength={MIN_PASSWORD_LENGTH} />;
}
