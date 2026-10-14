"use client"; // Error boundaries must be Client Components

import { RotateCw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto mt-10 max-w-lg rounded-2xl border bg-card p-8 text-center shadow-card">
      <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-rose-50 text-rose-700">
        <TriangleAlert className="size-5" />
      </span>
      <h2 className="text-lg font-semibold">Something went wrong</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        This page couldn&apos;t be loaded. Try again — if it keeps happening, check the server log{error.digest ? ` (reference ${error.digest})` : ""}.
      </p>
      <div className="mt-6 flex justify-center gap-2">
        <Button variant="outline" asChild>
          <Link href="/">Go to dashboard</Link>
        </Button>
        <Button onClick={() => retry()}>
          <RotateCw />Try again
        </Button>
      </div>
    </div>
  );
}
