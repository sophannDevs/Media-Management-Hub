import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/server/worker", () => ({ tick: vi.fn(async () => ({ processed: 0, published: 0, failed: 0, retry: 0 })) }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

import { NextRequest } from "next/server";
import { GET as files } from "@/app/api/files/[...key]/route";
import { GET as health } from "@/app/api/health/route";
import { POST as cron } from "@/app/api/cron/publish/route";
import { POST as upload } from "@/app/api/media/route";
import { onRequestError } from "@/instrumentation";
import { route } from "@/server/api";
import { runAction } from "@/server/actions/_run";
import { ServiceError } from "@/server/errors";

// ARCH-04: one failure shape for routes and actions, and exactly one structured
// log line with a request id for every failed request.

let lines: Record<string, unknown>[];

beforeEach(() => {
  lines = [];
  process.env.LOG_FORMAT = "json";
  for (const level of ["info", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((line: string) => void lines.push(JSON.parse(line)));
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.LOG_FORMAT;
  delete process.env.CRON_SECRET;
});

const failures = () => lines.filter((l) => l.level === "warn" || l.level === "error");
const cronRequest = (headers: Record<string, string> = {}) => new Request("http://app.test/api/cron/publish", { method: "POST", headers: { host: "app.test", ...headers } });

describe("Route Handlers", () => {
  it("refuse in the common shape, with a request id in the body, the header and one log line", async () => {
    const res = await cron(cronRequest()); // CRON_SECRET unset
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body).toEqual({ ok: false, error: "This endpoint is disabled. Set CRON_SECRET to enable it.", code: "SERVICE_UNAVAILABLE", requestId: expect.any(String) });
    expect(res.headers.get("x-request-id")).toBe(body.requestId);
    expect(failures()).toEqual([expect.objectContaining({ level: "warn", msg: "request refused", requestId: body.requestId, status: 503, code: "SERVICE_UNAVAILABLE", method: "POST", path: "/api/cron/publish" })]);
  });

  it("answer a wrong secret and a cross-site request the same way", async () => {
    process.env.CRON_SECRET = "right";
    const wrong = await cron(cronRequest({ authorization: "Bearer wrong" }));
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    const cross = await cron(cronRequest({ authorization: "Bearer right", origin: "https://evil.example" }));
    expect(cross.status).toBe(403);
    expect(await cross.json()).toMatchObject({ ok: false, error: "Cross-site request refused.", code: "FORBIDDEN" });
    expect(failures().map((l) => l.status)).toEqual([401, 403]);
  });

  it("report validation problems with their code", async () => {
    const res = await upload(new Request("http://app.test/api/media?type=NOT_A_TYPE&fileName=a.bin", { method: "POST", headers: { host: "app.test" }, body: "x" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: "Choose a media type.", code: "VALIDATION", requestId: expect.any(String) });
  });

  it("say so when a file doesn't exist", async () => {
    const res = await files(new NextRequest("http://app.test/api/files/no/such.png"), { params: Promise.resolve({ key: ["no", "such.png"] }) } as never);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ ok: false, error: "File not found.", code: "NOT_FOUND" });
  });

  it("turn an uncaught error into a 500 with the same id everywhere, logging the error once", async () => {
    const handler = route(async () => {
      throw new Error("boom: database exploded");
    });
    const res = await handler(new Request("http://app.test/api/x", { method: "POST" }));
    const body = await res.json();
    expect(res.status).toBe(500);
    // The message shown never reveals the cause
    expect(body).toEqual({ ok: false, error: "Something went wrong. Please try again.", code: "INTERNAL", requestId: expect.any(String) });
    expect(res.headers.get("x-request-id")).toBe(body.requestId);
    expect(failures()).toHaveLength(1);
    expect(failures()[0]).toMatchObject({ level: "error", msg: "request failed", requestId: body.requestId, status: 500, path: "/api/x", err: { message: "boom: database exploded" } });
  });

  it("keep a caller's acceptable request id and replace a bad one", async () => {
    const ok = await health(new Request("http://app.test/api/health", { headers: { "x-request-id": "edge-proxy-1234" } }));
    expect(ok.headers.get("x-request-id")).toBe("edge-proxy-1234");
    const bad = await health(new Request("http://app.test/api/health", { headers: { "x-request-id": "bad id with spaces" } }));
    expect(bad.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("Server Actions", () => {
  const noInput = z.undefined();

  it("hide an unexpected error from the person, give them a reference, and log it once with the stack", async () => {
    const r = await runAction(noInput, undefined, async () => {
      throw new Error("relation \"Nope\" does not exist");
    });
    expect(r).toEqual({ ok: false, error: "Something went wrong. Please try again.", code: "INTERNAL", requestId: expect.any(String) });
    expect(failures()).toHaveLength(1);
    expect(failures()[0]).toMatchObject({ level: "error", msg: "action failed", requestId: (r as { requestId: string }).requestId, userId: "test-owner", err: { message: expect.stringContaining("does not exist") } });
  });

  it("refuse with the service's own message and code, logging a warning", async () => {
    const r = await runAction(noInput, undefined, async () => {
      throw new ServiceError("Content not found.", undefined, "CONFLICT");
    });
    expect(r).toMatchObject({ ok: false, error: "Content not found.", code: "CONFLICT", requestId: expect.any(String) });
    expect(failures()).toEqual([expect.objectContaining({ level: "warn", msg: "action refused", code: "CONFLICT" })]);
  });

  it("refuse invalid input with the problems listed", async () => {
    const r = await runAction(z.object({ name: z.string().min(1, "Give it a name.") }), { name: "" }, async () => "never");
    expect(r).toMatchObject({ ok: false, error: "Please check the form.", details: ["Give it a name."], code: "VALIDATION" });
    expect(failures()).toEqual([expect.objectContaining({ msg: "action refused", code: "VALIDATION", details: ["Give it a name."] })]);
  });

  it("log nothing for a success", async () => {
    expect(await runAction(noInput, undefined, async () => 1)).toMatchObject({ ok: true, data: 1 });
    expect(lines).toEqual([]);
  });
});

describe("onRequestError (render errors and uncaught failures)", () => {
  const context = { routerKind: "App Router", routePath: "/content/[id]", routeType: "render", renderSource: "react-server-components", revalidateReason: undefined } as const;
  const request = (id: string) => ({ path: "/content/abc?tab=video", method: "GET", headers: { "x-request-id": id } });

  it("logs one line with the request id, the route and the digest the error page shows", async () => {
    const err = Object.assign(new Error("render failed"), { digest: "1234567" });
    await onRequestError(err, request("req-0000001"), context);
    expect(failures()).toEqual([
      expect.objectContaining({ level: "error", msg: "request failed", requestId: "req-0000001", method: "GET", path: "/content/abc", routePath: "/content/[id]", routeType: "render", digest: "1234567", err: expect.objectContaining({ message: "render failed" }) }),
    ]);
  });

  it("logs the same error once per request however many sections of the page report it", async () => {
    const err = Object.assign(new Error("database down"), { digest: "777" });
    for (let i = 0; i < 11; i++) await onRequestError(err, request("req-0000002"), context);
    expect(failures()).toHaveLength(1);
    // A different error in the same request, and the same error in another request, are separate failures
    await onRequestError(Object.assign(new Error("another"), { digest: "888" }), request("req-0000002"), context);
    await onRequestError(err, request("req-0000003"), context);
    expect(failures()).toHaveLength(3);
  });
});
