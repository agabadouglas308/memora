import { describe, expect, it } from "vitest";
import { embedText } from "./rag";
import { candidateIds, embeddingFor, tokensOf } from "./search-index";

const chunks = [
  {
    id: "a",
    text: "Chunk overlap preserves context across boundaries.",
    embedding: JSON.stringify(embedText("Chunk overlap preserves context across boundaries.")),
  },
  {
    id: "b",
    text: "Deployment requires a Node.js host.",
    embedding: JSON.stringify(embedText("Deployment requires a Node.js host.")),
  },
];

describe("candidateIds", () => {
  it("returns only chunks sharing a token with the question", () => {
    expect([...candidateIds("Why does overlap matter?", chunks)]).toEqual(["a"]);
    expect([...candidateIds("How is deployment handled?", chunks)]).toEqual(["b"]);
  });

  it("refreshes when the chunk set changes", () => {
    expect(candidateIds("overlap", chunks).has("c")).toBe(false);
    const next = [...chunks, { id: "c", text: "Overlap was added later.", embedding: JSON.stringify(embedText("Overlap was added later.")) }];
    expect(candidateIds("overlap", next).has("c")).toBe(true);
  });

  it("refreshes tokens when a chunk's text changes in place", () => {
    expect(candidateIds("overlap", chunks).has("a")).toBe(true);
    const changed = [{ ...chunks[0], text: "Deployment notes only." }, chunks[1]];
    expect(candidateIds("overlap", changed).has("a")).toBe(false);
    expect(candidateIds("deployment", changed).has("a")).toBe(true);
  });
});

describe("embeddingFor", () => {
  it("reuses cached vectors and parses changed ones", () => {
    const vector = embeddingFor("a", chunks[0].embedding);
    expect(embeddingFor("a", chunks[0].embedding)).toBe(vector);
    expect(embeddingFor("a", JSON.stringify([1, 0]))).toEqual([1, 0]);
  });
});

describe("tokensOf", () => {
  it("lowercases and extracts word tokens", () => {
    expect([...tokensOf("Overlapping CHUNKS!")]).toEqual(["overlapping", "chunks"]);
  });
});
