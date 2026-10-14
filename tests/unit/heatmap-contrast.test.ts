import { describe, expect, it } from "vitest";

// Guards the heatmap's text colour rule (A11Y-01): across the whole olive ramp,
// the better of white and black text must reach WCAG AA 4.5:1.
const LOW = [0xf4, 0xf6, 0xee];
const MID = [0xaf, 0xc0, 0x8a];
const HIGH = [0x38, 0x46, 0x20];
const mix = (a: number[], b: number[], t: number) => a.map((c, i) => Math.round(c + (b[i] - c) * t));
const ramp = (t: number) => (t < 0.5 ? mix(LOW, MID, t * 2) : mix(MID, HIGH, (t - 0.5) * 2));
const lum = ([r, g, b]: number[]) => {
  const lin = (c: number) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

describe("heatmap cell text contrast", () => {
  it("reaches 4.5:1 at every step of the ramp", () => {
    for (let i = 0; i <= 1000; i++) {
      const l = lum(ramp(i / 1000));
      const best = Math.max(1.05 / (l + 0.05), (l + 0.05) / 0.05);
      expect(best).toBeGreaterThanOrEqual(4.5);
    }
  });
});
