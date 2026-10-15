import { describe, expect, it } from "vitest";
import { autoValues, extractVariables, listVariables, renderTemplate, variablesToAsk } from "@/lib/ai/prompt-template";

// AI-02: templates say what they need, the app fills what it knows, nothing unfilled reaches a model.

describe("prompt templates (AI-02)", () => {
  it("finds each variable once, in order, whatever the case", () => {
    expect(extractVariables("Cinematic still, {subject}, {setting}, {Subject} again, {aspect_ratio}.")).toEqual(["subject", "setting", "aspect_ratio"]);
    expect(extractVariables("No variables here, not even {} or {1st}.")).toEqual([]);
  });

  it("renders what it has and names what is missing", () => {
    const r = renderTemplate("Write a {duration}-minute script about \"{title}\" for {audience}. Tone: {tone}.", { duration: "8–10", title: "Coffee Science", audience: "  home baristas " });
    expect(r.text).toBe("Write a 8–10-minute script about \"Coffee Science\" for home baristas. Tone: {tone}.");
    expect(r.missing).toEqual(["tone"]);
    expect(renderTemplate("{a} and {a}", { a: "" }).missing).toEqual(["a"]);
  });

  it("fills what it can from the content item and the image prompt", () => {
    const auto = autoValues({ title: "Kampot Pepper", targetAudience: "food lovers", language: "Khmer", contentType: "LONG_FORM", platforms: ["facebook", "youtube"] }, { style: "Cinematic", aspectRatio: "16:9" });
    expect(auto).toEqual({ title: "Kampot Pepper", topic: "Kampot Pepper", audience: "food lovers", language: "Khmer", duration: "8–10", platform: "Facebook", style: "Cinematic", aspect_ratio: "16:9" });
    expect(autoValues({ title: "Short one", contentType: "SHORT" })).toEqual({ title: "Short one", topic: "Short one", duration: "1" });
    // Only what a person must type is asked for
    expect(variablesToAsk("Cinematic still, {subject}, {setting}, {aspect_ratio}, about {topic}.", auto)).toEqual(["subject", "setting"]);
    expect(listVariables(["subject", "setting"])).toBe("{subject}, {setting}");
  });
});
