// Number formatting shared by the analytics server and client components.
// Explicit locales keep server and client output identical.

const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

/** 12,345 */
export const formatInt = (n: number) => whole.format(Math.round(n));

/** 12.3K */
export const formatCompact = (n: number) => compact.format(n);

/** Exact below 10,000, compact above: 1,284 · 12.9K · 4.2M */
export const formatCount = (n: number) => (Math.abs(n) < 10_000 ? formatInt(n) : formatCompact(n));

/** 0.0764 → "7.6%" ("—" when unknown) */
export const formatPercent = (ratio: number | null, digits = 1) => (ratio === null ? "—" : `${(ratio * 100).toFixed(digits)}%`);

/** 3.25 → "3.3 h", 1234 → "1,234 h" */
export const formatHours = (hours: number) => `${hours < 10 ? oneDecimal.format(hours) : whole.format(Math.round(hours))} h`;

/** Percent change vs the previous value; null when there is nothing to compare with. */
export const percentChange = (current: number, previous: number) => (previous > 0 ? ((current - previous) / previous) * 100 : null);

/** +38% / −4.2% */
export function formatSigned(value: number, unit = "%") {
  const abs = Math.abs(value);
  const text = abs >= 10 ? whole.format(abs) : oneDecimal.format(abs);
  if (text === "0") return `0${unit}`;
  return `${value > 0 ? "+" : "−"}${text}${unit}`;
}
