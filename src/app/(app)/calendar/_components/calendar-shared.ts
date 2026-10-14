// Pure helpers shared by the calendar's Server and Client Components.
// Keep this file free of server-only imports (db, services).

export const CALENDAR_VIEWS = ["month", "week", "day"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

export const VIEW_LABELS: Record<CalendarView, string> = { month: "Month", week: "Week", day: "Day" };

export interface CalendarParams {
  view: CalendarView;
  /** Anchor day ("yyyy-MM-dd"). Today when absent. */
  date?: string;
  platform?: string;
}

/** First and last hour rows of the week / day time grid (events outside are clamped into them). */
export const FIRST_HOUR = 7;
export const LAST_HOUR = 23;

/** dataTransfer types used for drag & drop (must be lower-case). */
export const DRAG_SCHEDULE = "application/x-mediaflow-schedule";
export const DRAG_CONTENT = "application/x-mediaflow-content";

/** Payload of a ready-content drag: the content and the platform to preselect in the Schedule dialog. */
export interface ContentDrag {
  id: string;
  platformId?: string;
}

export const encodeContentDrag = (d: ContentDrag) => JSON.stringify(d);

export function decodeContentDrag(raw: string): ContentDrag | null {
  try {
    const d = JSON.parse(raw) as Partial<ContentDrag>;
    return typeof d.id === "string" && d.id ? { id: d.id, platformId: typeof d.platformId === "string" ? d.platformId : undefined } : null;
  } catch {
    return null;
  }
}

type RawParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** True for a real calendar day written as "yyyy-MM-dd". */
export function isDayKey(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function parseCalendarParams(sp: RawParams): CalendarParams {
  const view = first(sp.view)?.toLowerCase();
  const date = first(sp.date);
  const platform = first(sp.platform)?.toLowerCase();
  return {
    view: CALENDAR_VIEWS.find((v) => v === view) ?? "month",
    date: isDayKey(date) ? date : undefined,
    platform: platform && /^[a-z_]{1,32}$/.test(platform) ? platform : undefined,
  };
}

/** Shareable calendar URL; defaults (month view, today, all platforms) are left out. */
export function calendarHref(p: Partial<CalendarParams>) {
  const q = new URLSearchParams();
  if (p.view && p.view !== "month") q.set("view", p.view);
  if (p.date) q.set("date", p.date);
  if (p.platform) q.set("platform", p.platform);
  const s = q.toString();
  return s ? `/calendar?${s}` : "/calendar";
}

export const pad2 = (n: number) => String(n).padStart(2, "0");

/** Grid row an event is shown in (hours outside the grid go to the first / last row). */
export const rowHour = (time: string) => Math.min(LAST_HOUR, Math.max(FIRST_HOUR, Number(time.slice(0, 2))));
