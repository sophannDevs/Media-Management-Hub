import { describe, expect, it } from "vitest";
import { GO_TO, interpretKey, isTypingTarget } from "@/lib/shortcuts";

// UX-06: which key presses are shortcuts.

const el = (tagName: string, extra: { type?: string; role?: string; editable?: boolean } = {}) =>
  ({ tagName, type: extra.type, isContentEditable: !!extra.editable, getAttribute: (n: string) => (n === "role" ? (extra.role ?? null) : null) }) as unknown as Element;

describe("interpretKey (UX-06)", () => {
  it("maps the single keys", () => {
    expect(interpretKey("/", false)).toEqual({ type: "search" });
    expect(interpretKey("c", false)).toEqual({ type: "create" });
    expect(interpretKey("?", false)).toEqual({ type: "help" });
    expect(interpretKey("g", false)).toEqual({ type: "chord" });
  });

  it("ignores everything else, including capitals", () => {
    for (const key of ["a", "C", "G", "Enter", "Escape", " ", "1", "ArrowDown"]) expect(interpretKey(key, false)).toBeNull();
  });

  it("goes to a page after g, and only then", () => {
    expect(interpretKey("d", false)).toBeNull();
    expect(interpretKey("c", true)).toEqual({ type: "go", href: "/content", label: "Content" });
    expect(interpretKey("l", true)).toEqual({ type: "go", href: "/calendar", label: "Content Calendar" });
    expect(interpretKey(",", true)).toEqual({ type: "go", href: "/settings", label: "Settings" });
  });

  it("cancels a pending g on any other key, so `g` then `?` is not help", () => {
    expect(interpretKey("?", true)).toBeNull();
    expect(interpretKey("/", true)).toBeNull();
    expect(interpretKey("g", true)).toBeNull();
    expect(interpretKey("x", true)).toBeNull();
  });

  it("gives every destination its own letter and a real page", () => {
    expect(new Set(GO_TO.map((g) => g.key)).size).toBe(GO_TO.length);
    expect(GO_TO.map((g) => g.href)).toEqual(["/", "/content", "/calendar", "/schedule", "/media", "/accounts", "/analytics", "/prompts", "/settings"]);
  });
});

describe("isTypingTarget (UX-06)", () => {
  it("is true where text goes in", () => {
    expect(isTypingTarget(el("INPUT", { type: "text" }))).toBe(true);
    expect(isTypingTarget(el("INPUT", { type: "search" }))).toBe(true);
    expect(isTypingTarget(el("INPUT", { type: "date" }))).toBe(true);
    expect(isTypingTarget(el("TEXTAREA"))).toBe(true);
    expect(isTypingTarget(el("SELECT"))).toBe(true);
    expect(isTypingTarget(el("DIV", { editable: true }))).toBe(true);
    expect(isTypingTarget(el("DIV", { role: "textbox" }))).toBe(true);
    expect(isTypingTarget(el("BUTTON", { role: "combobox" }))).toBe(true);
  });

  it("is false for buttons, links and the page itself", () => {
    expect(isTypingTarget(el("BODY"))).toBe(false);
    expect(isTypingTarget(el("A"))).toBe(false);
    expect(isTypingTarget(el("BUTTON"))).toBe(false);
    expect(isTypingTarget(el("INPUT", { type: "checkbox" }))).toBe(false);
    expect(isTypingTarget(el("INPUT", { type: "submit" }))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
