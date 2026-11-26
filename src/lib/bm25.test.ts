import { describe, expect, it } from "vitest";
import { bm25Scores } from "./bm25";

describe("bm25Scores", () => {
  it("ranks a document with the query term higher", () => {
    const scores = bm25Scores(["atlas"], [
      { id: "a", tokens: ["atlas", "atlas", "platform"] },
      { id: "b", tokens: ["deployment", "notes"] },
    ]);
    expect(scores.get("a")!).toBeGreaterThan(scores.get("b")!);
    expect(scores.get("b")).toBe(0);
  });

  it("gives rare terms more weight than terms in every document", () => {
    const documents = [
      { id: "a", tokens: ["rare", "common"] },
      { id: "b", tokens: ["common", "common"] },
    ];
    const rare = bm25Scores(["rare"], documents).get("a")!;
    const common = bm25Scores(["common"], documents).get("a")!;
    expect(rare).toBeGreaterThan(common);
  });

  it("returns zero scores for an empty document set", () => {
    expect(bm25Scores(["atlas"], []).size).toBe(0);
  });
});
