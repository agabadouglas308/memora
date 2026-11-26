import { describe, expect, it } from "vitest";
import { embedText } from "./rag";
import { rankChunks } from "./retrieval";

const texts = [
  "Chunk overlap preserves context across paragraph boundaries.",
  "Deployment requires a Node.js host and pdftotext.",
  "Evaluation uses recall@k and precision@k on a labeled set.",
];

const chunks = texts.map((text, position) => ({
  id: `chunk-${position}`,
  text,
  position,
  embedding: JSON.stringify(embedText(text)),
  documentId: "doc-1",
  documentName: "notes.md",
}));

function rank(question: string) {
  return rankChunks(question, chunks, embedText(question));
}

describe("rankChunks", () => {
  it("returns an empty list when there are no chunks", () => {
    expect(rankChunks("anything", [], embedText("anything"))).toEqual([]);
  });

  it("puts the chunk matching the question first", () => {
    expect(rank("Why does overlap matter?")[0].text).toContain("overlap");
    expect(rank("How is deployment handled?")[0].text).toContain("Deployment");
    expect(rank("How do we evaluate retrieval?")[0].text).toContain("Evaluation");
  });

  it("does not return chunks with no keyword or vector overlap", () => {
    expect(rank("quantum banana recipes")).toEqual([]);
  });

  it("limits the number of results", () => {
    expect(rankChunks("overlap deployment evaluation", chunks, embedText("overlap deployment evaluation"), { limit: 2 })).toHaveLength(2);
  });
});
