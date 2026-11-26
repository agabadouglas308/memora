import { answerFromContext, embedText } from "./rag";

export type Context = { text: string; documentName: string };

const host = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
const chatModel = process.env.OLLAMA_MODEL;
const embedModel = process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text";

export const embeddingModelName = chatModel ? embedModel : "hash-384";
export const usesOllama = () => Boolean(chatModel);

function endpoint(path: string) {
  return `${host.replace(/\/$/, "")}${path}`;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!chatModel) return texts.map((text) => embedText(text));

  const response = await fetch(endpoint("/api/embed"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: embedModel, input: texts }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Embedding request failed with ${response.status}`);

  const data = (await response.json()) as { embeddings?: number[][] };
  if (!Array.isArray(data.embeddings) || data.embeddings.length !== texts.length) {
    throw new Error("Embedding response did not match the input");
  }
  return data.embeddings;
}

export async function* streamAnswer(question: string, contexts: Context[]): AsyncGenerator<string> {
  if (!chatModel) {
    const answer = answerFromContext(question, contexts);
    for (const token of answer.match(/\S+\s*/g) ?? []) yield token;
    return;
  }

  const sources = contexts
    .map((context, index) => `[${index + 1}] ${context.documentName}\n${context.text}`)
    .join("\n\n");

  const response = await fetch(endpoint("/api/chat"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: chatModel,
      stream: true,
      messages: [
        {
          role: "system",
          content:
            "Answer using only the provided sources. If they do not contain the answer, say so. Cite sources by their bracket number.",
        },
        { role: "user", content: `Sources:\n${sources}\n\nQuestion: ${question}` },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok || !response.body) throw new Error(`Generation request failed with ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const parsed = JSON.parse(line) as { response?: string; error?: string };
      if (parsed.error) throw new Error(parsed.error);
      if (parsed.response) yield parsed.response;
    }
  }
}
