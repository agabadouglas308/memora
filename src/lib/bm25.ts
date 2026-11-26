export type Bm25Document = { id: string; tokens: string[] };

export function bm25Scores(queryTokens: string[], documents: Bm25Document[]) {
  const count = documents.length;
  const averageLength = documents.reduce((sum, doc) => sum + doc.tokens.length, 0) / Math.max(count, 1) || 1;
  const documentFrequency = new Map<string, number>();

  for (const document of documents) {
    for (const token of new Set(document.tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }

  const k1 = 1.5;
  const b = 0.75;
  const scores = new Map<string, number>();

  for (const document of documents) {
    const termFrequency = new Map<string, number>();
    for (const token of document.tokens) {
      termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1);
    }

    let score = 0;
    for (const token of new Set(queryTokens)) {
      const frequency = termFrequency.get(token) ?? 0;
      if (!frequency) continue;
      const withToken = documentFrequency.get(token) ?? 0;
      const idf = Math.log(1 + (count - withToken + 0.5) / (withToken + 0.5));
      const lengthRatio = document.tokens.length / averageLength;
      score += idf * (frequency * (k1 + 1)) / (frequency + k1 * (1 - b + b * lengthRatio));
    }
    scores.set(document.id, score);
  }

  return scores;
}
