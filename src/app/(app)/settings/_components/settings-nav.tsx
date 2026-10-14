"use client";

import { type MouseEvent, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { SETTINGS_SECTIONS } from "./settings-card";

const OFFSET = 120; // sticky header + breathing room

/** Section sub-navigation: sticky column on desktop, horizontal scroller on mobile. */
export function SettingsNav() {
  const [active, setActive] = useState(SETTINGS_SECTIONS[0].id);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      let current = SETTINGS_SECTIONS[0].id;
      for (const s of SETTINGS_SECTIONS) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= OFFSET) current = s.id;
      }
      // The last sections may be too short to reach the top
      const atBottom = window.scrollY > 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (atBottom) current = SETTINGS_SECTIONS[SETTINGS_SECTIONS.length - 1].id;
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  function go(e: MouseEvent<HTMLAnchorElement>, id: string) {
    const el = document.getElementById(id);
    if (!el) return; // sections still streaming in: let the browser handle the hash
    e.preventDefault();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    window.history.replaceState(null, "", `#${id}`);
    setActive(id);
  }

  return (
    <nav aria-label="Settings sections" className="thin-scroll -mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:sticky lg:top-24 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
      {SETTINGS_SECTIONS.map((s) => {
        const isActive = active === s.id;
        return (
          <a
            key={s.id}
            href={`#${s.id}`}
            onClick={(e) => go(e, s.id)}
            aria-current={isActive ? "location" : undefined}
            className={cn(
              "flex h-9 shrink-0 items-center gap-2.5 rounded-xl px-3 text-sm font-medium whitespace-nowrap transition-colors lg:h-10",
              isActive ? "bg-primary text-primary-foreground" : "text-stone-700 hover:bg-olive-50 hover:text-foreground",
            )}
          >
            <s.icon className={cn("size-4", isActive ? "text-white" : "text-stone-500")} aria-hidden />
            {s.label}
          </a>
        );
      })}
    </nav>
  );
}
