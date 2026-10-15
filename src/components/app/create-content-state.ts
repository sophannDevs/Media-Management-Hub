import type { ContentFormOptions } from "@/server/queries/shared";

/** Value of a Select that means "nothing chosen". */
export const NONE = "__none";
/** Where the unfinished form is kept in the browser (UX-03). */
export const DRAFT_KEY = "create-content";

/** A blank Create Content form (the language comes from the workspace settings). */
export function initialForm(options: ContentFormOptions) {
  return {
    title: "",
    idea: "",
    description: "",
    categoryId: NONE,
    contentType: "LONG_FORM",
    tags: "",
    targetAudience: "",
    language: options.defaultLanguage,
    platforms: options.platforms.filter((p) => p.enabled && p.id === "youtube").map((p) => p.id),
    priority: "MEDIUM",
    targetPublishDate: "",
    seriesId: NONE,
    campaignId: NONE,
  };
}

export type CreateContentValues = ReturnType<typeof initialForm>;
