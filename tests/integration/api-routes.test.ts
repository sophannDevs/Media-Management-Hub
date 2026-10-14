import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/worker", () => ({ tick: vi.fn(async () => ({ processed: 0, published: 0, failed: 0, retry: 0 })) }));

import { POST as cron } from "@/app/api/cron/publish/route";
import { POST as upload } from "@/app/api/media/route";
import { tick } from "@/server/worker";

const cronRequest = (headers: Record<string, string> = {}) => new Request("http://app.test/api/cron/publish", { method: "POST", headers: { host: "app.test", ...headers } });

afterEach(() => {
  delete process.env.CRON_SECRET;
  vi.mocked(tick).mockClear();
});

describe("POST /api/cron/publish (SEC-02)", () => {
  it("is disabled when CRON_SECRET is not set", async () => {
    const res = await cron(cronRequest({ authorization: "Bearer guess" }));
    expect(res.status).toBe(503);
    expect(tick).not.toHaveBeenCalled();
  });

  it("refuses a wrong secret", async () => {
    process.env.CRON_SECRET = "right-secret";
    expect((await cron(cronRequest({ authorization: "Bearer wrong-secret" }))).status).toBe(401);
    expect((await cron(cronRequest())).status).toBe(401);
    expect(tick).not.toHaveBeenCalled();
  });

  it("runs the worker with the right secret", async () => {
    process.env.CRON_SECRET = "right-secret";
    const res = await cron(cronRequest({ authorization: "Bearer right-secret" }));
    expect(res.status).toBe(200);
    expect(tick).toHaveBeenCalledOnce();
  });

  it("refuses a cross-site request even with the secret (SEC-03)", async () => {
    process.env.CRON_SECRET = "right-secret";
    const res = await cron(cronRequest({ authorization: "Bearer right-secret", origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect(tick).not.toHaveBeenCalled();
  });
});

describe("POST /api/media (SEC-03)", () => {
  it("refuses an upload posted from another site before reading the body", async () => {
    const form = new FormData();
    form.set("type", "IMAGE");
    form.set("file", new File(["<svg/>"], "a.svg", { type: "image/svg+xml" }));
    const res = await upload(new Request("http://app.test/api/media", { method: "POST", headers: { host: "app.test", origin: "https://evil.example" }, body: form }));
    expect(res.status).toBe(403);
  });
});
