"use server";

import { z } from "zod";
import { mediaLinkProblem } from "@/lib/security/url";
import { MediaType } from "@/lib/workflow/statuses";
import * as media from "../services/media";
import { id, ids, runAction } from "./_run";

export async function deleteMediaAction(assetId: string) {
  return runAction(id, assetId, (id) => media.deleteMediaAsset(id), "File deleted");
}

/** Several files at once (MEDIA-02). */
export async function bulkDeleteMediaAction(assetIds: string[]) {
  return runAction(ids, assetIds, (ids) => media.deleteMediaAssets(ids), (r) => `${r.removed} file${r.removed === 1 ? "" : "s"} deleted`);
}

export async function bulkAssignMediaAction(assetIds: string[], contentId: string | null) {
  return runAction(
    z.object({ ids, contentId: z.string().min(1).nullable() }),
    { ids: assetIds, contentId },
    (d) => media.assignMediaToContents(d.ids, d.contentId),
    (r) => (contentId ? `${r.moved} file${r.moved === 1 ? "" : "s"} moved` : `${r.moved} file${r.moved === 1 ? "" : "s"} unassigned`),
  );
}

export async function setImageSelectedAction(assetId: string, selected: boolean) {
  return runAction(z.object({ id, selected: z.boolean() }), { id: assetId, selected }, ({ id, selected }) => media.setImageSelected(id, selected));
}

export async function setThumbnailAction(contentId: string, assetId: string | null) {
  return runAction(
    z.object({ id, assetId: z.string().nullable() }),
    { id: contentId, assetId },
    ({ id, assetId }) => media.setContentThumbnail(id, assetId),
    "Thumbnail updated",
  );
}

export async function setFinalVideoAction(contentId: string, assetId: string) {
  return runAction(z.object({ id, assetId: id }), { id: contentId, assetId }, ({ id, assetId }) => media.setFinalVideo(id, assetId), "Final video updated");
}

export async function linkMediaAction(input: { contentId?: string | null; type: string; url: string; fileName?: string; durationSec?: number | null }) {
  return runAction(
    z.object({
      contentId: z.string().nullish(),
      type: z.enum(MediaType.codes as [string, ...string[]]),
      url: z.string().trim().superRefine((url, ctx) => {
        const problem = mediaLinkProblem(url);
        if (problem) ctx.addIssue({ code: "custom", message: problem });
      }),
      fileName: z.string().max(200).optional(),
      durationSec: z.number().positive().nullish(),
    }),
    input,
    (d) =>
      media.createMediaAsset({
        contentId: d.contentId ?? null,
        type: d.type,
        externalUrl: d.url,
        fileName: d.fileName?.trim() || decodeURIComponent(new URL(d.url).pathname.split("/").pop() || "linked-file"),
        mimeType: d.type === "VIDEO" ? "video/mp4" : d.type === "AUDIO" || d.type === "MUSIC" ? "audio/mpeg" : "image/jpeg",
        durationSec: d.durationSec ?? null,
      }),
    "File linked",
  );
}

export async function assignMediaAction(assetId: string, contentId: string | null) {
  return runAction(
    z.object({ id, contentId: z.string().nullable() }),
    { id: assetId, contentId },
    ({ id, contentId }) => media.assignMediaToContent(id, contentId),
    "File moved",
  );
}
