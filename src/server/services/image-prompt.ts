import { db } from "@/lib/db";
import { ActivityType } from "@/lib/workflow/statuses";
import { ServiceError } from "../errors";
import { logActivity } from "./activity";
import { syncPublishingStatus } from "./content";

export interface ImagePromptInput {
  prompt: string;
  negativePrompt?: string;
  style?: string;
  aspectRatio?: string;
  provider?: string;
}

export async function saveImagePrompt(contentId: string, input: ImagePromptInput) {
  const content = await db.content.findUnique({ where: { id: contentId }, select: { id: true } });
  if (!content) throw new ServiceError("Content not found.");
  const data = {
    prompt: input.prompt,
    negativePrompt: input.negativePrompt ?? "",
    style: input.style ?? "Cinematic",
    aspectRatio: input.aspectRatio ?? "16:9",
    provider: input.provider ?? "GOOGLE_AI_STUDIO",
  };
  await db.imagePrompt.upsert({ where: { contentId }, update: data, create: { contentId, ...data } });
  await logActivity({ contentId, type: ActivityType.IMAGE_PROMPT_SAVED, message: "Image prompt saved" });
  await syncPublishingStatus(contentId);
}
