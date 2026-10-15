// URL state of the Content list, shared by the server query and the client
// controls (no server imports here).

export interface ContentListParams {
  q?: string;
  stage?: string;
  platform?: string;
  category?: string;
  priority?: string;
  created?: string;
  scheduled?: string;
  /** Published on "any" platform, on "all" the platforms it was posted to, or "none" yet (WF-02) */
  published?: string;
  view?: string;
  sort?: string;
  dir?: string;
  /** Keyset cursors: the page after / before the content with this id */
  after?: string;
  before?: string;
}

export const LIST_PARAMS = ["q", "stage", "platform", "category", "priority", "created", "scheduled", "published", "view", "sort", "dir", "after", "before"] as const;

export type SortDir = "asc" | "desc";

export type ContentView = "table" | "cards";
/** Remembers the last table / cards choice */
export const VIEW_COOKIE = "mf_content_view";

/** Sortable columns and the direction a first click sorts in. */
export const CONTENT_SORTS = {
  updated: { label: "Last updated", dir: "desc" },
  created: { label: "Created", dir: "desc" },
  title: { label: "Title", dir: "asc" },
  priority: { label: "Priority", dir: "asc" },
  stage: { label: "Status", dir: "asc" },
  completion: { label: "Checklist", dir: "desc" },
  next: { label: "Next post", dir: "asc" },
} as const satisfies Record<string, { label: string; dir: SortDir }>;
export type ContentSort = keyof typeof CONTENT_SORTS;

export function parseSort(params: Pick<ContentListParams, "sort" | "dir">): { sort: ContentSort; dir: SortDir } {
  const sort = params.sort && params.sort in CONTENT_SORTS ? (params.sort as ContentSort) : "updated";
  const dir = params.dir === "asc" || params.dir === "desc" ? params.dir : CONTENT_SORTS[sort].dir;
  return { sort, dir };
}

/**
 * A list query string as a saved view stores it (UX-02): known parameters
 * only, without the page cursors, in a fixed order, so equal views compare equal.
 */
export function viewQuery(query: string | ContentListParams) {
  const sp = typeof query === "string" ? new URLSearchParams(query.replace(/^\?/, "")) : null;
  const out = new URLSearchParams();
  for (const k of LIST_PARAMS) {
    if (k === "after" || k === "before") continue;
    const v = (sp ? sp.get(k) : (query as ContentListParams)[k])?.trim();
    if (v && !(k === "stage" && v === "ALL")) out.set(k, v.slice(0, 200));
  }
  return out.toString();
}

/**
 * Link to the list with some parameters changed. Any change other than the
 * page itself starts again from the first page.
 */
export function buildHref(params: ContentListParams, patch: Partial<ContentListParams>) {
  const paging = "after" in patch || "before" in patch;
  const next: ContentListParams = { ...params, ...(paging ? {} : { after: undefined, before: undefined }), ...patch };
  const sp = new URLSearchParams();
  for (const k of LIST_PARAMS) {
    const v = next[k];
    if (!v || (k === "stage" && v === "ALL")) continue;
    sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `/content?${s}` : "/content";
}
