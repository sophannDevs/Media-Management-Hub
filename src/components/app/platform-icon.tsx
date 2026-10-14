import { cn } from "@/lib/utils";

export const PLATFORM_NAMES: Record<string, string> = {
  youtube: "YouTube",
  facebook: "Facebook",
  youtube_shorts: "YouTube Shorts",
  facebook_reels: "Facebook Reels",
  tiktok: "TikTok",
  instagram: "Instagram",
};

/** Brand marks for supported platforms (inline SVG, no external assets). */
export function PlatformIcon({ platform, size = 16, className }: { platform: string; size?: number; className?: string }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", className: cn("shrink-0", className), role: "img" as const };
  switch (platform) {
    case "youtube":
    case "youtube_shorts":
      return (
        <svg {...common} aria-label="YouTube">
          <rect x="1" y="4.5" width="22" height="15" rx="4.5" fill="var(--youtube)" />
          <path d="M10 9v6l5.2-3z" fill="#fff" />
        </svg>
      );
    case "facebook":
    case "facebook_reels":
      return (
        <svg {...common} aria-label="Facebook">
          <circle cx="12" cy="12" r="11" fill="var(--facebook)" />
          <path d="M13.2 19v-6h2l.3-2.4h-2.3V9.2c0-.7.2-1.2 1.2-1.2h1.2V5.9c-.2 0-1-.1-1.8-.1-1.8 0-3 1.1-3 3.1v1.7H8.8V13h2v6z" fill="#fff" />
        </svg>
      );
    case "tiktok":
      return (
        <svg {...common} aria-label="TikTok">
          <rect width="24" height="24" rx="6" fill="#1c1b17" />
          <path d="M14.5 5.5c.4 1.6 1.5 2.7 3 2.9v2.3c-1.1 0-2.1-.3-3-.9v4.4a3.9 3.9 0 1 1-3.9-3.9v2.3a1.6 1.6 0 1 0 1.6 1.6V5.5z" fill="#fff" />
        </svg>
      );
    case "instagram":
      return (
        <svg {...common} aria-label="Instagram">
          <rect width="24" height="24" rx="6" fill="#c13584" />
          <rect x="6" y="6" width="12" height="12" rx="3.5" fill="none" stroke="#fff" strokeWidth="1.6" />
          <circle cx="12" cy="12" r="2.8" fill="none" stroke="#fff" strokeWidth="1.6" />
          <circle cx="15.6" cy="8.4" r=".9" fill="#fff" />
        </svg>
      );
    default:
      return <span className={cn("inline-block rounded-full bg-muted", className)} style={{ width: size, height: size }} />;
  }
}

export function PlatformLabel({ platform, size = 14, className }: { platform: string; size?: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
      <PlatformIcon platform={platform} size={size} />
      {PLATFORM_NAMES[platform] ?? platform}
    </span>
  );
}

export function PlatformStack({ platforms, size = 18 }: { platforms: string[]; size?: number }) {
  if (!platforms.length) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center -space-x-1" title={platforms.map((p) => PLATFORM_NAMES[p] ?? p).join(", ")}>
      {platforms.map((p) => (
        <span key={p} className="rounded-full bg-white ring-2 ring-white">
          <PlatformIcon platform={p} size={size} />
        </span>
      ))}
    </span>
  );
}
