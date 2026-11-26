import { describe, expect, it } from "vitest";
import {
  answerFromContext,
  chunkText,
  cosine,
  embedText,
  parseEmbedding,
} from "./rag";

describe("chunkText", () => {
  it("returns nothing for blank input", () => {
    expect(chunkText("   \n  ")).toEqual([]);
  });

  it("handles text shorter than the overlap without looping", () => {
    expect(chunkText("hello world")).toEqual(["hello world"]);
    expect(chunkText("short text", 900, 180)).toEqual(["short text"]);
  });

  it("splits long text into overlapping chunks", () => {
    const text = Array.from({ length: 60 }, (_, i) => `line ${i} words here`).join("\n");
    const chunks = chunkText(text, 200, 50);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].length).toBeLessThanOrEqual(200);
    const overlap = chunks[0].split("\n").slice(-2).join("\n");
    expect(chunks[1]).toContain(overlap.trim());
  });

  it("advances past the start on every iteration", () => {
    const chunks = chunkText("x".repeat(500), 100, 20);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toHaveLength(100);
    expect(chunks.every((chunk) => chunk.length > 0)).toBe(true);
  });
});

describe("embedText", () => {
  it("produces a normalized vector of the requested size", () => {
    const vector = embedText("Atlas retrieval and citations", 384);
    expect(vector).toHaveLength(384);
    expect(Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))).toBeCloseTo(1, 5);
  });

  it("is deterministic and ignores stop words", () => {
    expect(embedText("chunk overlap matters")).toEqual(embedText("chunk overlap matters"));
    expect(embedText("the and is are")).toEqual(embedText("the and is are"));
  });

  it("returns a zero vector when no term survives", () => {
    expect(embedText("the and is are")).toEqual(new Array(384).fill(0));
  });
});

describe("cosine", () => {
  it("scores identical vectors at one and opposites at minus one", () => {
    const vector = [1, 2, 3];
    expect(cosine(vector, vector)).toBeCloseTo(1, 5);
    expect(cosine(vector, [-1, -2, -3])).toBeCloseTo(-1, 5);
    expect(cosine([1, 0], [0, 1])).toBe(0);
  });
});

describe("parseEmbedding", () => {
  it("accepts valid JSON and rejects malformed or non numeric values", () => {
    expect(parseEmbedding("[1,2,3]")).toEqual([1, 2, 3]);
    expect(parseEmbedding("[1,null,3]")).toEqual([1, 3]);
    expect(parseEmbedding("not json")).toEqual(new Array(384).fill(0));
    expect(parseEmbedding('{"a":1}')).toEqual(new Array(384).fill(0));
  });
});

describe("answerFromContext", () => {
  it("falls back gracefully with no context", () => {
    expect(answerFromContext("anything", [])).toContain("could not find");
  });

  it("selects sentences that match the question terms", () => {
    const answer = answerFromContext("Why is overlap important?", [
      {
        text: "Chunk overlap preserves context. Unrelated filler sentence about nothing at all.",
        documentName: "notes.md",
      },
    ]);
    expect(answer).toContain("Chunk overlap preserves context");
    expect(answer).not.toContain("Unrelated filler");
    expect(answer).toContain("grounded in the cited source");
  });
});
