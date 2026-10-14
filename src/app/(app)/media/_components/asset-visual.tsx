import { AudioLines, File, Music, Play } from "lucide-react";
import { ContentThumb } from "@/components/app/content-thumb";
import { cn } from "@/lib/utils";
import type { MediaItem } from "@/server/queries/media";

function hash(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Static "waveform" for audio files (deterministic per file, so server and client match). */
function Waveform({ seed, music, large }: { seed: string; music: boolean; large?: boolean }) {
  const h = hash(seed);
  const Icon = music ? Music : AudioLines;
  return (
    <div className="flex size-full flex-col items-center justify-center gap-2 bg-[#f7f5e6] text-olive-700">
      <Icon className={large ? "size-10" : "size-7"} aria-hidden />
      <div className={cn("flex items-end gap-0.5", large ? "h-10" : "h-5")} aria-hidden>
        {Array.from({ length: large ? 36 : 18 }, (_, i) => (
          <span key={i} className={cn("rounded-full bg-olive-300", large ? "w-1.5" : "w-1")} style={{ height: `${20 + ((i * 37 + h) % 80)}%` }} />
        ))}
      </div>
    </div>
  );
}

/**
 * Preview surface of a media file: the image itself, a video poster (the
 * content's thumbnail) with a play badge, a waveform for audio, or an icon.
 */
export function AssetVisual({ asset, large, className }: { asset: MediaItem; large?: boolean; className?: string }) {
  let body;
  switch (asset.type) {
    case "IMAGE":
    case "THUMBNAIL":
      body = <ContentThumb src={asset.url} seed={asset.id} icon="image" className="size-full rounded-none" />;
      break;
    case "VIDEO":
      body = (
        <>
          <ContentThumb src={asset.posterUrl} seed={asset.content?.id ?? asset.id} icon="play" className="size-full rounded-none" />
          {asset.posterUrl && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/10">
              <span className={cn("flex items-center justify-center rounded-full bg-black/55 text-white", large ? "size-14" : "size-10")}>
                <Play className={cn("translate-x-px fill-current", large ? "size-6" : "size-4")} aria-hidden />
              </span>
            </span>
          )}
        </>
      );
      break;
    case "AUDIO":
    case "MUSIC":
      body = <Waveform seed={asset.id} music={asset.type === "MUSIC"} large={large} />;
      break;
    default:
      body = (
        <div className="flex size-full items-center justify-center bg-[#f7f5e6] text-olive-700">
          <File className={large ? "size-10" : "size-7"} aria-hidden />
        </div>
      );
  }
  return <div className={cn("relative overflow-hidden", className)}>{body}</div>;
}
