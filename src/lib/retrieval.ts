import { cosine } from "./rag";
import { bm25Scores } from "./bm25";
import { candidateIds, embeddingFor, tokensOf } from "./search-index";

export type SearchChunk = {
  id: string;
  text: string;
  position: number;
  embedding: string;
  documentId: string;
  documentName: string;
};

export type RankedChunk = SearchChunk & { score: number };

type Options = {
  useCandidates?: boolean;
  vectorWeight?: number;
  keywordWeight?: number;
  limit?: number;
};

export function rankChunks(
  question: string,
  chunks: SearchChunk[],
  queryEmbedding: number[],
  options: Options = {}
): RankedChunk[] {
  const { useCandidates = true, vectorWeight = 0.6, keywordWeight = 0.4, limit = 5 } = options;
  if (!chunks.length) return [];

  const candidates = candidateIds(question, chunks);
  const pool = useCandidates ? chunks.filter((chunk) => candidates.has(chunk.id)) : chunks;
  if (!pool.length) return [];

  const vectorScores = new Map(
    pool.map((chunk) => [chunk.id, cosine(queryEmbedding, embeddingFor(chunk.id, chunk.embedding))])
  );
  const keywordScores = bm25Scores(
    [...tokensOf(question)],
    pool.map((chunk) => ({ id: chunk.id, tokens: [...tokensOf(chunk.text)] }))
  );

  const maxVector = Math.max(0, ...vectorScores.values()) || 1;
  const maxKeyword = Math.max(0, ...keywordScores.values()) || 1;

  return pool
    .map((chunk) => ({
      ...chunk,
      score:
        vectorWeight * ((vectorScores.get(chunk.id) ?? 0) / maxVector) +
        keywordWeight * ((keywordScores.get(chunk.id) ?? 0) / maxKeyword),
    }))
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
