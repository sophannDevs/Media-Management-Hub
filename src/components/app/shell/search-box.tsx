"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";

/** Global search: submits to the Content page (title, tag, description). Ctrl/⌘+K focuses it. */
export function SearchBox() {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <form
      role="search"
      className="relative min-w-0 flex-1 md:max-w-md"
      onSubmit={(e) => {
        e.preventDefault();
        const q = new FormData(e.currentTarget).get("q")?.toString().trim();
        router.push(q ? `/content?q=${encodeURIComponent(q)}` : "/content");
      }}
    >
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input ref={ref} name="q" aria-label="Search content" aria-keyshortcuts="Control+K Meta+K" className="h-9 bg-white/80 pr-14 pl-9" placeholder="Search title, tag, description…" />
      <kbd className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 rounded border border-stone-200 bg-white px-1.5 py-0.5 text-xs text-muted-foreground sm:inline">Ctrl K</kbd>
    </form>
  );
}
