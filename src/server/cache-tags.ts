/** Tags of data cached across requests with "use cache"; mutations expire them with updateTag(). */
export const CACHE_TAGS = {
  /** Categories, series, campaigns, platforms and the default language (Create Content dialog, filters) */
  formOptions: "form-options",
} as const;
