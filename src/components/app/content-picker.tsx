"use client";

import { Check, Search } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { ContentOption } from "@/server/queries/content";

export type PickerChoice = { id: string; title: string; ready?: boolean };

/**
 * Search-as-you-type content picker (PERF-11). It asks the server for the 20
 * best matches (GET /api/content/search) instead of loading the whole library.
 * An editable combobox with a listbox popup: arrows move, Enter picks, Escape
 * closes. `fixed` choices (e.g. "Unassigned") are listed first while nothing is typed.
 */
export function ContentPicker({
  value,
  onChange,
  label = "Content",
  placeholder = "Choose content",
  fixed = [],
  readiness = true,
  className,
  inputClassName,
}: {
  value: PickerChoice | null;
  onChange: (choice: PickerChoice) => void;
  label?: string;
  /** Shown when nothing is chosen */
  placeholder?: string;
  fixed?: PickerChoice[];
  /** Ready-to-post items first, others marked "not ready" (scheduling); otherwise most recent first */
  readiness?: boolean;
  className?: string;
  inputClassName?: string;
}) {
  const listId = useId();
  const anchor = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<ContentOption[] | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    const t = setTimeout(
      () =>
        fetch(`/api/content/search?q=${encodeURIComponent(q)}${readiness ? "" : "&order=recent"}`, { signal: ctrl.signal })
          .then((r) => (r.ok ? (r.json() as Promise<ContentOption[]>) : []))
          .then((rows) => {
            setFound(rows);
            setActive(0);
          })
          .catch(() => {}),
      q ? 200 : 0,
    );
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, open, readiness]);

  const items: PickerChoice[] | null = found && [...(q.trim() ? [] : fixed), ...found];

  function choose(o: PickerChoice) {
    setOpen(false);
    setQ("");
    if (o.id !== value?.id) onChange(o);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const n = items?.length ?? 0;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return setOpen(true);
      if (n) setActive((i) => (i + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
    } else if (e.key === "Enter" && open && items?.[active]) {
      e.preventDefault();
      choose(items[active]);
    } else if (e.key === "Escape" && open) {
      // Close the list, not the dialog around it
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      setQ("");
    }
  }

  const option = (i: number) => `${listId}-o${i}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div ref={anchor} className={cn("relative", className)}>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            role="combobox"
            aria-label={label}
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && items?.[active] ? option(active) : undefined}
            className={cn(
              "h-9 w-full truncate rounded-md border border-input bg-white py-1 pr-3 pl-9 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
              inputClassName,
            )}
            value={open ? q : (value?.title ?? "")}
            placeholder={open ? (value?.title ?? "Search content") : placeholder}
            onClick={() => setOpen(true)}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onKeyDown={onKeyDown}
          />
          {/* Results arrive as you type; say how many (the list itself is in a popup) */}
          <p role="status" className="sr-only">
            {!open ? "" : items === null ? "Loading results" : items.length === 0 ? "No content found" : `${items.length} result${items.length === 1 ? "" : "s"}`}
          </p>
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) min-w-72 p-1"
        // Typing stays in the input; clicks on it don't count as "outside"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if (anchor.current?.contains(e.target as Node)) e.preventDefault();
        }}
      >
        <ul id={listId} role="listbox" aria-label={label} className="thin-scroll max-h-72 overflow-y-auto">
          {items === null ? (
            <li className="px-2 py-1.5 text-muted-foreground">Loading…</li>
          ) : items.length === 0 ? (
            <li className="px-2 py-1.5 text-muted-foreground">No content matches &ldquo;{q}&rdquo;</li>
          ) : (
            items.map((o, i) => (
              <li
                key={o.id}
                id={option(i)}
                role="option"
                aria-selected={i === active}
                className={cn("flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5", i === active && "bg-accent text-accent-foreground", i === fixed.length - 1 && !q.trim() && "mb-1 border-b border-border pb-2")}
                onMouseEnter={() => setActive(i)}
                // mousedown, so the input keeps focus
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(o);
                }}
              >
                <Check className={cn("size-4 shrink-0", o.id === (value?.id ?? "") ? "opacity-100" : "opacity-0")} />
                <span className="min-w-0 flex-1 truncate">{o.title}</span>
                {readiness && o.ready === false && <span className="shrink-0 text-xs text-muted-foreground">not ready</span>}
              </li>
            ))
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
