import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger, redact, serializeError } from "@/lib/log";
import { acceptRequestId, shortRequestId } from "@/lib/request-id";

// ARCH-04: one structured line per event; secrets never printed.

let lines: { level: string; record: Record<string, unknown> }[];

beforeEach(() => {
  lines = [];
  process.env.LOG_FORMAT = "json";
  delete process.env.LOG_LEVEL;
  for (const level of ["info", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((line: string) => void lines.push({ level, record: JSON.parse(line) }));
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.LOG_FORMAT;
  delete process.env.LOG_LEVEL;
});

describe("logger (ARCH-04)", () => {
  it("writes one JSON line with time, level, message and fields", () => {
    createLogger().info("post published", { scheduleId: "s1", attempt: 2 });
    expect(lines).toHaveLength(1);
    expect(lines[0].record).toMatchObject({ level: "info", msg: "post published", scheduleId: "s1", attempt: 2 });
    expect(new Date(lines[0].record.time as string).toISOString()).toBe(lines[0].record.time);
  });

  it("child loggers add their fields to every line", () => {
    const log = createLogger({ component: "worker" }).child({ requestId: "r-1" });
    log.warn("something", { n: 1 });
    expect(lines[0]).toMatchObject({ level: "warn", record: { component: "worker", requestId: "r-1", n: 1 } });
  });

  it("sends warn and error to their own streams and honours LOG_LEVEL", () => {
    process.env.LOG_LEVEL = "warn";
    const log = createLogger();
    log.info("quiet");
    log.warn("w");
    log.error("e");
    expect(lines.map((l) => l.level)).toEqual(["warn", "error"]);
  });

  it("redacts secrets by key name, at any depth, and leaves similar names alone", () => {
    createLogger().info("login", {
      password: "hunter2",
      accessToken: "ya29.abc",
      headers: { Authorization: "Bearer xyz", cookie: "mf_session=abc", "x-request-id": "r-1" },
      accounts: [{ name: "AI Lab", refreshToken: "1//abc" }],
      hashtags: "#ai #tools",
    });
    const text = JSON.stringify(lines[0].record);
    for (const secret of ["hunter2", "ya29.abc", "Bearer xyz", "mf_session=abc", "1//abc"]) expect(text).not.toContain(secret);
    expect(lines[0].record).toMatchObject({
      password: "[redacted]",
      accessToken: "[redacted]",
      headers: { Authorization: "[redacted]", cookie: "[redacted]", "x-request-id": "r-1" },
      accounts: [{ name: "AI Lab", refreshToken: "[redacted]" }],
      hashtags: "#ai #tools",
    });
  });

  it("removes the password from a connection URL inside a message or an error", () => {
    createLogger().error("db down", { url: "postgresql://mediaflow:s3cr3t-pw@127.0.0.1:5433/mediaflow", err: new Error("Can't reach postgres://app:hunter2@db.internal:5432/app") });
    const text = JSON.stringify(lines[0].record);
    expect(text).not.toContain("s3cr3t-pw");
    expect(text).not.toContain("hunter2");
    expect(text).toContain("postgresql://mediaflow:[redacted]@127.0.0.1:5433/mediaflow");
    expect(text).toContain("postgres://app:[redacted]@db.internal:5432/app");
  });

  it("serialises errors with their code, digest, stack and cause", () => {
    const err = Object.assign(new Error("boom", { cause: new Error("root cause") }), { code: "P2002", digest: "123" });
    createLogger().error("request failed", { err });
    const logged = lines[0].record.err as Record<string, unknown>;
    expect(logged).toMatchObject({ name: "Error", message: "boom", code: "P2002", digest: "123", cause: { message: "root cause" } });
    expect(String(logged.stack)).toContain("boom");
    expect(String(logged.stack).split("\n").length).toBeLessThanOrEqual(8);
  });

  it("bounds what it prints: depth, array length and string length", () => {
    const deep = { a: { b: { c: { d: { e: "too deep" } } } } };
    expect(JSON.stringify(redact(deep))).toContain("[truncated]");
    expect((redact(Array.from({ length: 100 }, (_, i) => i)) as number[]).length).toBe(25);
    expect((redact("x".repeat(5_000)) as string).length).toBeLessThan(2_100);
    expect(serializeError("plain text")).toEqual({ message: "plain text" });
  });

  it("prints readable text instead of JSON in pretty mode", () => {
    process.env.LOG_FORMAT = "pretty";
    const out = vi.spyOn(console, "info").mockImplementation(() => {});
    createLogger().info("hello", { requestId: "r-1" });
    expect(out.mock.calls[0][0]).toMatch(/^\d\d:\d\d:\d\d INFO  hello {2}requestId=r-1$/);
  });
});

describe("request ids (ARCH-04)", () => {
  it("accepts a plain caller-supplied id and refuses anything else", () => {
    expect(acceptRequestId("4f1c9c4e-2f0a-4f0e-8f6b-0a1b2c3d4e5f")).toBe("4f1c9c4e-2f0a-4f0e-8f6b-0a1b2c3d4e5f");
    expect(acceptRequestId("abc")).toBeNull(); // too short
    expect(acceptRequestId("x".repeat(65))).toBeNull(); // too long
    expect(acceptRequestId('id with spaces and "quotes"')).toBeNull();
    expect(acceptRequestId("line\nbreak-injection")).toBeNull();
    expect(acceptRequestId(null)).toBeNull();
  });

  it("shortens an id to what a person can quote", () => {
    expect(shortRequestId("4f1c9c4e-2f0a-4f0e-8f6b-0a1b2c3d4e5f")).toBe("4f1c9c4e");
  });
});
