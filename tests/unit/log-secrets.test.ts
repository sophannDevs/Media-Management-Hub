import { describe, expect, it } from "vitest";
import { redact, serializeError } from "@/lib/log";

// SEC-04: a token never reaches a log line, not even inside a message a
// platform API echoed back.

describe("log redaction of tokens in strings (SEC-04)", () => {
  it("blanks tokens in query strings and form bodies", () => {
    const msg = "GET https://graph.facebook.com/v25.0/me?fields=id&access_token=EAAB1234567890abc&debug=1 failed";
    expect(redact(msg)).toBe("GET https://graph.facebook.com/v25.0/me?fields=id&access_token=[redacted]&debug=1 failed");
    expect(redact("refresh_token=1//0gabcdef&grant_type=refresh_token&client_secret=GOCSPX-xyz")).toBe("refresh_token=[redacted]&grant_type=refresh_token&client_secret=[redacted]");
    expect(redact("oauth/access_token?client_id=1&fb_exchange_token=EAAB999&x=1")).toBe("oauth/access_token?client_id=1&fb_exchange_token=[redacted]&x=1");
    expect(redact("callback?code=4/0AX4XfWh&state=abc")).toBe("callback?code=[redacted]&state=abc");
  });

  it("blanks bearer and OAuth headers", () => {
    expect(redact("request had header Authorization: Bearer ya29.a0AfH6SMBexample")).toBe("request had header Authorization: Bearer [redacted]");
    expect(redact("Authorization: OAuth EAABsbCS1iHgBAexample")).toBe("Authorization: OAuth [redacted]");
  });

  it("leaves ordinary text alone", () => {
    expect(redact("token count: 12, the code was fine")).toBe("token count: 12, the code was fine");
    expect(redact("Bearer of bad news")).toBe("Bearer of bad news");
  });

  it("applies to error messages too", () => {
    const e = serializeError(new Error("401 for https://oauth2.googleapis.com/token?refresh_token=1//secret"));
    expect(JSON.stringify(e)).not.toContain("1//secret");
    expect(JSON.stringify(e)).toContain("refresh_token=[redacted]");
  });
});
