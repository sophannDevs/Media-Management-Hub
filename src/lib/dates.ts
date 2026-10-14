import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { differenceInCalendarDays } from "date-fns";

export const TIMEZONES = [
  { value: "Asia/Phnom_Penh", label: "Asia/Phnom_Penh (GMT+7)" },
  { value: "Asia/Bangkok", label: "Asia/Bangkok (GMT+7)" },
  { value: "Asia/Seoul", label: "Asia/Seoul (GMT+9)" },
  { value: "Asia/Singapore", label: "Asia/Singapore (GMT+8)" },
  { value: "Europe/London", label: "Europe/London" },
  { value: "America/New_York", label: "America/New_York" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles" },
  { value: "UTC", label: "UTC" },
];

/** Combine a wall-clock date ("2026-10-20") and time ("19:00") in a timezone into a UTC Date. */
export function zonedToUtc(date: string, time: string, timeZone: string) {
  return fromZonedTime(`${date}T${time.length === 5 ? `${time}:00` : time}`, timeZone);
}

export function fmt(date: Date | string | number, timeZone: string, pattern: string) {
  return formatInTimeZone(new Date(date), timeZone, pattern);
}

export const fmtDate = (d: Date | string, tz: string) => fmt(d, tz, "MMM d, yyyy");
export const fmtShort = (d: Date | string, tz: string) => fmt(d, tz, "MMM d");
export const fmtTime = (d: Date | string, tz: string) => fmt(d, tz, "h:mm a");
export const fmtDateTime = (d: Date | string, tz: string) => fmt(d, tz, "MMM d, yyyy · h:mm a");

/** "yyyy-MM-dd" of the date as seen in the timezone. */
export const dayKey = (d: Date | string, tz: string) => fmt(d, tz, "yyyy-MM-dd");
export const timeKey = (d: Date | string, tz: string) => fmt(d, tz, "HH:mm");

/** Calendar-day difference between two instants, as seen in the timezone. */
export function dayDiff(d: Date | string, now: Date, tz: string) {
  return differenceInCalendarDays(new Date(`${dayKey(d, tz)}T00:00:00`), new Date(`${dayKey(now, tz)}T00:00:00`));
}

export function relativeDay(d: Date | string, now: Date, tz: string) {
  const diff = dayDiff(d, now, tz);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return fmt(d, tz, "EEE, MMM d");
}

export function timeAgo(d: Date | string, now: Date) {
  const mins = Math.round((now.getTime() - new Date(d).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}

export function formatDuration(sec?: number | null) {
  if (!sec && sec !== 0) return "";
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

export function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i >= 2 ? 1 : 0)} ${units[i]}`;
}

export function compactNumber(n: number) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/** "2026-10-13" + n days → "2026-10-14" (pure calendar math, timezone-free). */
export function addDaysToKey(key: string, n: number) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday of a day key: 1 = Monday … 7 = Sunday. */
export function weekdayOfKey(key: string) {
  const day = new Date(`${key}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** The seven day keys (Mon–Sun) of the week containing `key`. */
export function weekKeys(key: string) {
  const monday = addDaysToKey(key, 1 - weekdayOfKey(key));
  return Array.from({ length: 7 }, (_, i) => addDaysToKey(monday, i));
}

/** UTC instant range [start, end) covering whole local days fromKey..toKey in the timezone. */
export function dayRangeUtc(fromKey: string, toKey: string, timeZone: string) {
  return { gte: zonedToUtc(fromKey, "00:00", timeZone), lt: zonedToUtc(addDaysToKey(toKey, 1), "00:00", timeZone) };
}
