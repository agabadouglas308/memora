const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from",
  "has", "he", "in", "is", "it", "its", "of", "on", "or", "that", "the",
  "to", "was", "were", "will", "with", "what", "when", "where", "who", "why",
]);

export function chunkText(text: string, size = 900, overlap = 180) {
  const clean = text.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").trim();
  if (!clean) return [];

  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const boundary = clean.lastIndexOf("\n", end);
      if (boundary > start + size * 0.55) end = boundary;
    }
    const chunk = clean.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    start = end - overlap;
  }
  return chunks;
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function embedText(text: string, dimensions = 384): number[] {
  const vector = new Array(dimensions).fill(0);
  const tokens = text
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9'-]{1,}/g) ?? [];

  for (const token of tokens) {
    if (STOP_WORDS.has(token) || token.length < 3) continue;
    const index = hashString(token) % dimensions;
    const sign = (hashString(`${token}:sign`) & 1) === 0 ? 1 : -1;
    vector[index] += sign;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return magnitude ? vector.map((value) => value / magnitude) : vector;
}

export function cosine(a: number[], b: number[]) {
  let sum = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) sum += a[i] * b[i];
  return sum;
}

export function answerFromContext(question: string, contexts: Array<{ text: string; documentName: string }>) {
  if (!contexts.length) {
    return "I could not find relevant information in the uploaded documents. Try rephrasing your question or add a related document.";
  }

  const questionTerms = new Set(
    (question.toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g) ?? []).filter((term) => !STOP_WORDS.has(term))
  );

  const sentences = contexts
    .flatMap((context) =>
      context.text
        .replace(/\n+/g, " ")
        .split(/(?<=[.!?])\s+/)
        .map((sentence) => sentence.trim())
        .filter((sentence) => sentence.length > 35)
        .map((sentence) => ({
          sentence,
          documentName: context.documentName,
          score: (sentence.toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g) ?? [])
            .filter((term) => questionTerms.has(term)).length,
        }))
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const selected = sentences.length ? sentences : contexts.slice(0, 2).map((context) => ({
    sentence: context.text.slice(0, 420).trim(),
    documentName: context.documentName,
  }));

  return `Based on your knowledge base, ${selected
    .map((item) => `${item.sentence.replace(/\s+/g, " ")}`)
    .join(" ")}\n\nThis answer is grounded in the cited source passages below.`;
}
