import { Clapperboard, ImageIcon, Lightbulb, Play, Smartphone } from "lucide-react";
import { formatDuration } from "@/lib/dates";
import { thumbSrcSet } from "@/lib/media-url";
import { cn } from "@/lib/utils";

const GRADIENTS = [
  ["#556B2F", "#A9BC85"], ["#3d4a5c", "#8ea3b8"], ["#7a5a2f", "#d4b483"], ["#6b4f4f", "#c9a9a6"],
  ["#2f4f4f", "#7fa8a3"], ["#4a5d23", "#c2c78a"], ["#5c4a3d", "#b8a088"], ["#3b3f58", "#9a9cc4"],
  ["#6b5b2f", "#e0c97a"], ["#2f3b2f", "#8faf8f"], ["#584a3e", "#a8957f"], ["#40513b", "#9dc08b"],
];

function hashIndex(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h) % GRADIENTS.length;
}

/**
 * Thumbnail for a content item or media asset. Shows the image when a URL is
 * available, otherwise a soft deterministic gradient with an icon.
 */
export function ContentThumb({
  src,
  seed,
  alt = "",
  icon = "video",
  durationSec,
  className,
  sizes,
  blur,
}: {
  src?: string | null;
  seed: string;
  alt?: string;
  icon?: "video" | "short" | "idea" | "image" | "play";
  durationSec?: number | null;
  className?: string;
  /** How wide the thumbnail is laid out, for the browser to pick a size (PERF-08); default: a card in a grid */
  sizes?: string;
  /** A tiny blurred copy (data URI) shown until the image loads */
  blur?: string | null;
}) {
  const [a, b] = GRADIENTS[hashIndex(seed)];
  const Icon = { video: Clapperboard, short: Smartphone, idea: Lightbulb, image: ImageIcon, play: Play }[icon];
  return (
    <div
      className={cn("relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg text-white/90", className)}
      style={{ background: blur ? `url(${blur}) center / cover no-repeat, linear-gradient(135deg, ${a}, ${b})` : `linear-gradient(135deg, ${a}, ${b})` }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- user media served from /api/files, sizes vary
        <img src={src} srcSet={thumbSrcSet(src)} sizes={sizes ?? "(max-width: 640px) 50vw, 320px"} alt={alt} className="absolute inset-0 size-full object-cover" loading="lazy" decoding="async" />
      ) : (
        <Icon className="size-[38%] max-h-7 max-w-7 opacity-90" aria-hidden />
      )}
      {durationSec ? (
        <span className="absolute right-1 bottom-1 rounded bg-black/65 px-1 text-xs font-medium text-white">{formatDuration(durationSec)}</span>
      ) : null}
    </div>
  );
}

/** Picks the placeholder icon for a content item. */
export function thumbIconFor(c: { contentType: string; stage?: string }) {
  if (c.stage === "IDEA") return "idea" as const;
  return c.contentType === "LONG_FORM" ? ("video" as const) : ("short" as const);
}
