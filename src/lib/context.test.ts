import { describe, expect, it } from "vitest";
import { buildSources, sanitizeSource } from "./context";

describe("sanitizeSource", () => {
  it("strips control characters and caps length", () => {
    const dirty = `hello\u0000world\u0007${"x".repeat(5000)}`;
    const clean = sanitizeSource(dirty, 100);
    expect(clean).not.toMatch(/[\u0000\u0007]/);
    expect(clean).toHaveLength(100);
  });

  it("collapses excessive blank lines", () => {
    expect(sanitizeSource("a\n\n\n\n\nb")).toBe("a\n\nb");
  });
});

describe("buildSources", () => {
  it("wraps and indexes sanitized sources", () => {
    const result = buildSources([
      { documentName: "a<b>.md", text: "Atlas is a platform." },
      { documentName: "notes.md", text: "Overlap preserves context." },
    ]);
    expect(result).toContain('<source index="1" name="ab.md">');
    expect(result).toContain('<source index="2" name="notes.md">');
    expect(result).toContain("Atlas is a platform.");
  });
});
