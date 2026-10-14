import { describe, expect, it } from "vitest";
import { fileEtag, isNotModified, parseRange, rangeApplies } from "@/lib/http-cache";

const modified = new Date("2026-10-14T10:00:00.789Z");
const etag = fileEtag(561, modified);
const req = (headers: Record<string, string>) => new Headers(headers);

describe("parseRange (PERF-06)", () => {
  it("reads start-end, start- and clamps the end to the file", () => {
    expect(parseRange("bytes=0-99", 561)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=100-", 561)).toEqual({ start: 100, end: 560 });
    expect(parseRange("bytes=500-9999", 561)).toEqual({ start: 500, end: 560 });
    expect(parseRange("bytes=0-0", 561)).toEqual({ start: 0, end: 0 });
  });

  it("serves a suffix range as the LAST n bytes (the audit's bytes=-20 returned bytes 0-20)", () => {
    expect(parseRange("bytes=-20", 561)).toEqual({ start: 541, end: 560 });
    expect(parseRange("bytes=-1", 561)).toEqual({ start: 560, end: 560 });
    // A suffix longer than the file is the whole file
    expect(parseRange("bytes=-9999", 561)).toEqual({ start: 0, end: 560 });
  });

  it("says unsatisfiable when nothing can be served", () => {
    expect(parseRange("bytes=561-", 561)).toBe("unsatisfiable");
    expect(parseRange("bytes=1000-2000", 561)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", 561)).toBe("unsatisfiable");
    expect(parseRange("bytes=-5", 0)).toBe("unsatisfiable");
  });

  it("ignores a header it can't or won't honour, so the whole file is sent", () => {
    for (const h of [null, "", "items=0-9", "bytes=", "bytes=-", "bytes=abc", "bytes=5-2", "bytes=0-9,20-29", "bytes=0-9, 20-"]) {
      expect(parseRange(h, 561), String(h)).toBeNull();
    }
  });

  it("tolerates spaces and any case in the unit", () => {
    expect(parseRange("Bytes = 10 - 19", 561)).toEqual({ start: 10, end: 19 });
  });
});

describe("conditional requests (PERF-06)", () => {
  it("makes a strong ETag from size and modification time", () => {
    expect(etag).toMatch(/^"[0-9a-f]+-[0-9a-f]+"$/);
    expect(fileEtag(562, modified)).not.toBe(etag);
    expect(fileEtag(561, new Date(modified.getTime() + 1))).not.toBe(etag);
  });

  it("answers 304 when If-None-Match has the tag, in any list position, weakly, or *", () => {
    expect(isNotModified(req({ "if-none-match": etag }), etag, modified)).toBe(true);
    expect(isNotModified(req({ "if-none-match": `"other", ${etag}` }), etag, modified)).toBe(true);
    expect(isNotModified(req({ "if-none-match": `W/${etag}` }), etag, modified)).toBe(true);
    expect(isNotModified(req({ "if-none-match": "*" }), etag, modified)).toBe(true);
    expect(isNotModified(req({ "if-none-match": '"other"' }), etag, modified)).toBe(false);
    expect(isNotModified(req({}), etag, modified)).toBe(false);
  });

  it("uses If-Modified-Since only without If-None-Match, with second precision", () => {
    const same = modified.toUTCString();
    const before = new Date(modified.getTime() - 5_000).toUTCString();
    expect(isNotModified(req({ "if-modified-since": same }), etag, modified)).toBe(true);
    expect(isNotModified(req({ "if-modified-since": before }), etag, modified)).toBe(false);
    expect(isNotModified(req({ "if-modified-since": "not a date" }), etag, modified)).toBe(false);
    // The tag decides when both are sent
    expect(isNotModified(req({ "if-none-match": '"other"', "if-modified-since": same }), etag, modified)).toBe(false);
  });

  it("honours Range only while If-Range still matches the file", () => {
    expect(rangeApplies(null, etag, modified)).toBe(true);
    expect(rangeApplies(etag, etag, modified)).toBe(true);
    expect(rangeApplies('"stale"', etag, modified)).toBe(false);
    expect(rangeApplies(`W/${etag}`, etag, modified)).toBe(false); // a weak tag never validates a range
    expect(rangeApplies(modified.toUTCString(), etag, modified)).toBe(true);
    expect(rangeApplies(new Date(modified.getTime() - 60_000).toUTCString(), etag, modified)).toBe(false);
  });
});
