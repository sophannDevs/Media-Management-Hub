import { SearchX } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/app/content-bits";
import { Button } from "@/components/ui/button";

export default function ContentNotFound() {
  return (
    <div className="rounded-2xl border bg-card shadow-card">
      <EmptyState
        icon={<SearchX />}
        title="Content not found"
        description="It may have been deleted. Check the content list or the archive in Settings."
        action={<Button asChild><Link href="/content">Back to content</Link></Button>}
      />
    </div>
  );
}
