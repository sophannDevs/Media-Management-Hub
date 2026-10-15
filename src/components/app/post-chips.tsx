import { PLATFORM_NAMES, PlatformIcon } from "@/components/app/platform-icon";
import { TONE_CLASSES } from "@/components/app/status-badge";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/workflow/statuses";

export interface PostChip {
  id: string;
  platformId: string;
  status: string;
  simulated: boolean;
  account: string;
}

const WORD: Record<string, [string, Tone]> = {
  PUBLISHED: ["Live", "success"],
  FAILED: ["Failed", "danger"],
  PROCESSING: ["Publishing", "progress"],
  WAITING: ["Scheduled", "scheduled"],
  RETRY_SCHEDULED: ["Retrying", "warn"],
};

/**
 * One chip per post (WF-02): the platform and where that post stands, so a
 * video that is live on YouTube and failed on Facebook shows both at a glance.
 */
export function PostChips({ posts, size = "sm", className }: { posts: PostChip[]; size?: "sm" | "default"; className?: string }) {
  if (!posts.length) return null;
  return (
    <ul className={cn("flex flex-wrap items-center gap-1", className)} aria-label="Posts by platform">
      {posts.map((p) => {
        const [word, tone]: [string, Tone] = p.status === "PUBLISHED" && p.simulated ? ["Simulated", "success"] : (WORD[p.status] ?? [p.status, "neutral"]);
        const name = PLATFORM_NAMES[p.platformId] ?? p.platformId;
        return (
          <li
            key={p.id}
            className={cn("inline-flex items-center gap-1 rounded-full border font-medium whitespace-nowrap", size === "sm" ? "h-5 px-1.5 text-[11px]" : "h-[22px] px-2 text-xs", TONE_CLASSES[tone])}
            title={`${name} (${p.account}): ${word}`}
          >
            <PlatformIcon platform={p.platformId} size={12} />
            <span className="sr-only">{name}: </span>
            {word}
          </li>
        );
      })}
    </ul>
  );
}
