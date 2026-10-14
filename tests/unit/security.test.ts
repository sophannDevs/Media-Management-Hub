import { afterEach, describe, expect, it } from "vitest";
import { csvCell } from "@/lib/csv";
import { isCrossSite } from "@/lib/security/origin";
import { checkBearer } from "@/lib/security/secret";
import { mediaLinkProblem } from "@/lib/security/url";

describe("csvCell (SEC-07)", () => {
  it.each(["=HYPERLINK(\"http://evil.example/x\",\"Open\")", "+1+1", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd"])("neutralises a formula: %j", (value) => {
    const cell = csvCell(value);
    expect(cell.replace(/^"/, "").startsWith("'")).toBe(true);
  });

  it("leaves ordinary text alone and quotes when needed", () => {
    expect(csvCell("AI tools")).toBe("AI tools");
    expect(csvCell('He said "hi", then left')).toBe('"He said ""hi"", then left"');
    expect(csvCell(null)).toBe("");
  });
});

describe("mediaLinkProblem (SEC-06)", () => {
  it.each([
    ["javascript:alert(1)", "Only https links are allowed."],
    ["data:text/html,<script>alert(1)</script>", "Only https links are allowed."],
    ["file:///etc/passwd", "Only https links are allowed."],
    ["http://example.com/video.mp4", "Only https links are allowed."],
    ["https://169.254.169.254/latest/meta-data/", "Links to local or private network addresses aren't allowed."],
    ["https://127.0.0.1/x.mp4", "Links to local or private network addresses aren't allowed."],
    ["https://2130706433/x.mp4", "Links to local or private network addresses aren't allowed."],
    ["https://10.1.2.3/x.mp4", "Links to local or private network addresses aren't allowed."],
    ["https://192.168.0.10/x.mp4", "Links to local or private network addresses aren't allowed."],
    ["https://localhost/x.mp4", "Links to local or private network addresses aren't allowed."],
    ["https://[::1]/x.mp4", "Links to local or private network addresses aren't allowed."],
    ["https://user:pw@example.com/x.mp4", "Links can't contain a user name or password."],
    ["not a url", "Enter a valid URL."],
  ])("refuses %s", (url, message) => {
    expect(mediaLinkProblem(url)).toBe(message);
  });

  it("accepts public https links", () => {
    expect(mediaLinkProblem("https://drive.google.com/file/d/abc/view")).toBeNull();
    expect(mediaLinkProblem("  https://cdn.example.com/a.mp4  ")).toBeNull();
  });
});

describe("isCrossSite (SEC-03)", () => {
  const post = (headers: Record<string, string>) => new Request("http://app.test/api/media", { method: "POST", headers });
  afterEach(() => {
    delete process.env.ALLOWED_ORIGINS;
  });

  it("allows same-origin and origin-less requests", () => {
    expect(isCrossSite(post({ host: "app.test", origin: "http://app.test" }))).toBe(false);
    expect(isCrossSite(post({ host: "app.test" }))).toBe(false);
  });

  it("refuses other sites, opaque origins and cross-site fetches", () => {
    expect(isCrossSite(post({ host: "app.test", origin: "https://evil.example" }))).toBe(true);
    expect(isCrossSite(post({ host: "app.test", origin: "null" }))).toBe(true);
    expect(isCrossSite(post({ host: "app.test", "sec-fetch-site": "cross-site" }))).toBe(true);
  });

  it("accepts hosts listed in ALLOWED_ORIGINS", () => {
    process.env.ALLOWED_ORIGINS = "admin.example.com, https://ops.example.com";
    expect(isCrossSite(post({ host: "app.test", origin: "https://admin.example.com" }))).toBe(false);
    expect(isCrossSite(post({ host: "app.test", origin: "https://ops.example.com" }))).toBe(false);
  });
});

describe("checkBearer (SEC-02)", () => {
  const req = (auth?: string) => new Request("http://app.test/api/cron/publish", { method: "POST", headers: auth ? { authorization: auth } : {} });

  it("reports an unset secret so callers fail closed", () => {
    expect(checkBearer(req("Bearer anything"), "")).toBe("unset");
    expect(checkBearer(req(), undefined)).toBe("unset");
  });

  it("accepts only the exact secret", () => {
    expect(checkBearer(req("Bearer s3cret"), "s3cret")).toBe("ok");
    expect(checkBearer(req("Bearer s3cre"), "s3cret")).toBe("denied");
    expect(checkBearer(req(), "s3cret")).toBe("denied");
  });
});
