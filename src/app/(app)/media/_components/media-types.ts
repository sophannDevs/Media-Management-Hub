import { File, Film, ImageIcon, type LucideIcon, Mic, Music, PanelsTopLeft } from "lucide-react";
import { MediaType } from "@/lib/workflow/statuses";

export const MEDIA_TYPE_ICONS: Record<string, LucideIcon> = {
  IMAGE: ImageIcon,
  VIDEO: Film,
  THUMBNAIL: PanelsTopLeft,
  AUDIO: Mic,
  MUSIC: Music,
  OTHER: File,
};

/** "Images", "Videos", "Thumbnails", "Audio", "Music", "Other" */
export function mediaTypePlural(code: string) {
  const label = MediaType.label(code);
  return ["AUDIO", "MUSIC", "OTHER"].includes(code) ? label : `${label}s`;
}
