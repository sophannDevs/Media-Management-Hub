"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A video's short silent preview (PERF-08), played while the mouse is over
 * the card. Nothing is fetched until then; touch screens and people who asked
 * for less motion never see it; the poster underneath stays for everyone else.
 */
export function HoverPreview({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const start = () => {
    const v = ref.current;
    if (!v) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !window.matchMedia("(pointer: fine)").matches) return;
    v.play().catch(() => {});
  };
  const stop = () => {
    const v = ref.current;
    if (!v) return;
    v.pause();
    v.currentTime = 0;
  };
  return (
    <video
      ref={ref}
      src={src}
      muted
      loop
      playsInline
      preload="none"
      aria-hidden
      tabIndex={-1}
      onMouseEnter={start}
      onMouseLeave={stop}
      onPlaying={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
      className={cn("absolute inset-0 size-full object-cover transition-opacity", playing ? "opacity-100" : "opacity-0")}
    />
  );
}
