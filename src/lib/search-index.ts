import { parseEmbedding } from "./rag";

export type IndexedChunk = { id: string; embedding: string; text: string };

type Entry = { value: string; vector: number[]; tokens: Set<string> };

let signature = "";
let entries = new Map<string, Entry>();

function signatureOf(chunks: IndexedChunk[]) {
  let hash = 2166136261;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.id.length; i++) {
      hash ^= chunk.id.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  }
  return `${chunks.length}:${hash >>> 0}`;
}

export function tokensOf(text: string) {
  return new Set(text.toLowerCase().match(/[a-z0-9][a-z0-9'-]{1,}/g) ?? []);
}

export function embeddingFor(id: string, value: string) {
  const entry = entries.get(id);
  return entry && entry.value === value ? entry.vector : parseEmbedding(value);
}

export function candidateIds(question: string, chunks: IndexedChunk[]) {
  const nextSignature = signatureOf(chunks);
  if (nextSignature !== signature) {
    const next = new Map<string, Entry>();
    for (const chunk of chunks) {
      next.set(chunk.id, {
        value: chunk.embedding,
        vector: parseEmbedding(chunk.embedding),
        tokens: tokensOf(chunk.text),
      });
    }
    entries = next;
    signature = nextSignature;
  }

  const queryTokens = tokensOf(question);
  const candidates = new Set<string>();
  for (const [id, entry] of entries) {
    for (const token of queryTokens) {
      if (entry.tokens.has(token)) {
        candidates.add(id);
        break;
      }
    }
  }
  return candidates;
}
