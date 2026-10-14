// Structured logging (ARCH-04). One line per event: JSON in production (what a
// log shipper wants), readable text in development. Values under keys that look
// like secrets are redacted. No Node-only imports, so it also runs in the proxy.
//
//   LOG_LEVEL   debug | info (default) | warn | error
//   LOG_FORMAT  json (default in production) | pretty (default otherwise)

export type Level = "debug" | "info" | "warn" | "error";
export type Fields = Record<string, unknown>;

const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
/** A key containing one of these (any case) holds a secret. */
const SECRET_KEYS = ["password", "passwd", "secret", "token", "authorization", "cookie", "apikey", "api_key", "api-key", "credential"];
const MAX_DEPTH = 4;
const MAX_STRING = 2_000;
const MAX_ITEMS = 25;

const threshold = () => RANK[(process.env.LOG_LEVEL as Level) in RANK ? (process.env.LOG_LEVEL as Level) : "info"];
const pretty = () => (process.env.LOG_FORMAT ?? (process.env.NODE_ENV === "production" ? "json" : "pretty")) === "pretty";
const isSecret = (key: string) => SECRET_KEYS.some((s) => key.toLowerCase().includes(s));

/** Bounds a string and removes the password from any connection URL in it (database errors sometimes echo one). */
function clean(text: string) {
  const bounded = text.length > MAX_STRING ? `${text.slice(0, MAX_STRING)}…` : text;
  return bounded.replace(/([a-z][a-z0-9+.-]*:\/\/[^:/\s@]+:)[^@/\s]+@/gi, "$1[redacted]@");
}

/** A copy that is safe to print: secrets redacted, depth, length and array size bounded, errors serialised. */
export function redact(value: unknown, depth = 0): unknown {
  if (value instanceof Error) return serializeError(value);
  if (typeof value === "string") return clean(value);
  if (value === null || typeof value !== "object") return typeof value === "bigint" ? String(value) : value;
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((v) => redact(v, depth + 1));
  const out: Fields = {};
  for (const [k, v] of Object.entries(value as Fields).slice(0, 50)) out[k] = isSecret(k) ? "[redacted]" : redact(v, depth + 1);
  return out;
}

export function serializeError(e: unknown, depth = 0): Fields {
  if (!(e instanceof Error)) return { message: typeof e === "string" ? e : String(redact(e)) };
  const extra = e as Error & { code?: unknown; digest?: unknown; cause?: unknown };
  return {
    name: e.name,
    message: clean(e.message),
    ...(extra.code !== undefined ? { code: extra.code } : {}),
    ...(extra.digest !== undefined ? { digest: extra.digest } : {}),
    ...(e.stack ? { stack: clean(e.stack.split("\n").slice(0, 8).join("\n")) } : {}),
    ...(extra.cause !== undefined && depth < 2 ? { cause: serializeError(extra.cause, depth + 1) } : {}),
  };
}

function prettyLine(record: Fields) {
  const { time, level, msg, err, ...rest } = record;
  const fields = Object.entries(rest)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" ");
  const stack = err && typeof err === "object" ? `\n${(err as Fields).stack ?? (err as Fields).message}` : "";
  return `${String(time).slice(11, 19)} ${String(level).toUpperCase().padEnd(5)} ${msg}${fields ? `  ${fields}` : ""}${stack}`;
}

export function log(level: Level, msg: string, fields: Fields = {}) {
  if (RANK[level] < threshold()) return;
  const { err, ...rest } = fields;
  const record: Fields = { time: new Date().toISOString(), level, msg, ...(redact(rest) as Fields), ...(err !== undefined ? { err: redact(err) } : {}) };
  const line = pretty() ? prettyLine(record) : JSON.stringify(record);
  // warn and error go to stderr, the rest to stdout
  console[level === "debug" ? "log" : level](line);
}

export interface Logger {
  debug(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
  /** A logger that adds these fields to every line (request id, schedule id, component…). */
  child(fields: Fields): Logger;
}

export function createLogger(base: Fields = {}): Logger {
  const at = (level: Level) => (msg: string, fields?: Fields) => log(level, msg, { ...base, ...fields });
  return { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error"), child: (fields) => createLogger({ ...base, ...fields }) };
}

export const logger = createLogger();
