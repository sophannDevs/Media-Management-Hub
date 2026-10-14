import { describe, expect, it } from "vitest";
import { buildHref, parseSort, viewQuery } from "@/lib/content-list";

describe("content list URLs", () => {
  it("normalises a saved view: known parameters only, no paging, fixed order", () => {
    expect(viewQuery("?sort=title&after=abc&priority=HIGH&utm=x&stage=ALL")).toBe("priority=HIGH&sort=title");
    expect(viewQuery({ stage: "READY", q: "  coffee ", before: "x" })).toBe("q=coffee&stage=READY");
    expect(viewQuery("")).toBe("");
  });

  it("starts from the first page when anything but the page changes", () => {
    const params = { stage: "READY", after: "abc" };
    expect(buildHref(params, { sort: "title", dir: "asc" })).toBe("/content?stage=READY&sort=title&dir=asc");
    expect(buildHref({ stage: "READY" }, { after: "xyz" })).toBe("/content?stage=READY&after=xyz");
  });

  it("falls back to the default sort and each column's first direction", () => {
    expect(parseSort({})).toEqual({ sort: "updated", dir: "desc" });
    expect(parseSort({ sort: "title" })).toEqual({ sort: "title", dir: "asc" });
    expect(parseSort({ sort: "nonsense", dir: "sideways" })).toEqual({ sort: "updated", dir: "desc" });
  });
});
