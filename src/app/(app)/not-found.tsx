import { Compass } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/app/content-bits";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto mt-10 max-w-lg rounded-2xl border bg-card shadow-card">
      <EmptyState
        icon={<Compass />}
        title="Page not found"
        description="The page you're looking for doesn't exist or was moved."
        action={<Button asChild><Link href="/">Back to dashboard</Link></Button>}
      />
    </div>
  );
}
