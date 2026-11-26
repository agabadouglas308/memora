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
    const next = end - overlap;
    // Never move backwards: a negative or stalled start would loop forever.
    start = next > start ? next : end;
  }
  return chunks;
}

const SUFFIXES = [
  ["ingly", ""], ["edly", ""], ["ing", ""], ["ies", "y"], ["es", ""],
  ["ed", ""], ["ions", ""], ["ion", ""], ["s", ""],
] as const;

export function stem(token: string) {
  if (token.length <= 4) return token;
  let value = token;
  for (const [suffix, replacement] of SUFFIXES) {
    if (value.endsWith(suffix) && value.length - suffix.length + replacement.length >= 3) {
      value = value.slice(0, -suffix.length) + replacement;
      break;
    }
  }
  if (value.length > 3 && value[value.length - 1] === value[value.length - 2]) {
    value = value.slice(0, -1);
  }
  return value.length > 3 && value.endsWith("e") ? value.slice(0, -1) : value;
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
    const root = stem(token);
    const index = hashString(root) % dimensions;
    const sign = (hashString(`${root}:sign`) & 1) === 0 ? 1 : -1;
    vector[index] += sign;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return magnitude ? vector.map((value) => value / magnitude) : vector;
}

export function cosine(a: number[], b: number[]) {
  let dot = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    magnitudeA += a[i] * a[i];
    magnitudeB += b[i] * b[i];
  }
  const denominator = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);
  return denominator ? dot / denominator : 0;
}

export function parseEmbedding(value: string, dimensions = 384): number[] {
  const empty = new Array<number>(dimensions).fill(0);
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return empty;
    const vector = parsed.filter(
      (item): item is number => typeof item === "number" && Number.isFinite(item)
    );
    return vector.length ? vector : empty;
  } catch {
    return empty;
  }
}

export function answerFromContext(question: string, contexts: Array<{ text: string; documentName: string }>) {
  if (!contexts.length) {
    return "I could not find relevant information in the uploaded documents. Try rephrasing your question or add a related document.";
  }

  const questionTerms = new Set(
    (question.toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g) ?? [])
      .filter((term) => !STOP_WORDS.has(term))
      .map(stem)
  );

  const sentences = contexts
    .flatMap((context) =>
      context.text
        .replace(/\n+/g, " ")
        .split(/(?<=[.!?])\s+/)
        .map((sentence) => sentence.replace(/^#+\s*/, "").trim())
        .filter((sentence) => sentence.length > 24)
        .map((sentence) => ({
          sentence,
          documentName: context.documentName,
          score: (sentence.toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g) ?? [])
            .filter((term) => questionTerms.has(stem(term))).length,
        }))
    )
    .filter((item) => item.score > 0)
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
