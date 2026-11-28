import { answerFromContext, embedText } from "./rag";
import { buildMessages } from "./context";
import {
  embedWithHosted,
  hostedConfig,
  streamFromHosted,
  validateVectors,
} from "./hosted";

export type Context = { text: string; documentName: string };
export type ProviderKind = "hosted" | "ollama" | "hash";
export type ChatKind = ProviderKind;

const config = hostedConfig();
const host = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
const chatModel = process.env.OLLAMA_MODEL;
const embedModel = process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text";
const PROVIDER_RETRY_MS = 5 * 60_000;

let embeddingsDisabledUntil = 0;
let chatDisabledUntil = 0;

export const usesHosted = () => Boolean(config);
export const usesOllama = () => !config && Boolean(chatModel);
export const usesHashMode = () => !config && !chatModel;
export const embeddingModelName = config?.embedModel
  ? `api:${config.embedModel}`
  : chatModel ? embedModel : "hash-384-v2";

function activeEmbedConfig() {
  return config?.embedModel && Date.now() >= embeddingsDisabledUntil ? config : null;
}

function activeChatConfig() {
  return config && Date.now() >= chatDisabledUntil ? config : null;
}

export function activeChatKind(): ChatKind {
  if (activeChatConfig()) return "hosted";
  if (chatModel) return "ollama";
  return "hash";
}

function disableEmbeddings() {
  embeddingsDisabledUntil = Date.now() + PROVIDER_RETRY_MS;
}

function disableChat() {
  chatDisabledUntil = Date.now() + PROVIDER_RETRY_MS;
}

function endpoint(path: string) {
  return `${host.replace(/\/$/, "")}${path}`;
}

async function embedWithOllama(texts: string[]) {
  const response = await fetch(endpoint("/api/embed"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: embedModel, input: texts }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Embedding request failed with ${response.status}`);

  const data = (await response.json()) as { embeddings?: unknown };
  return validateVectors(
    Array.isArray(data.embeddings) ? data.embeddings : [],
    texts.length
  );
}

function localEmbeddings(texts: string[]) {
  return texts.map((text) => embedText(text));
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const active = activeEmbedConfig();
  if (active) return embedWithHosted(texts, active);
  if (chatModel) return embedWithOllama(texts);
  return localEmbeddings(texts);
}

export async function embedWithFallback(texts: string[]): Promise<{
  vectors: number[][];
  model: string;
  kind: ProviderKind;
}> {
  const active = activeEmbedConfig();
  if (active) {
    try {
      return {
        vectors: await embedWithHosted(texts, active),
        model: `api:${active.embedModel}`,
        kind: "hosted",
      };
    } catch (error) {
      disableEmbeddings();
      console.warn("Hosted embeddings unavailable, using fallback:", error instanceof Error ? error.message : "unknown");
    }
  }

  if (chatModel) {
    try {
      return { vectors: await embedWithOllama(texts), model: embedModel, kind: "ollama" };
    } catch (error) {
      console.warn("Ollama embeddings unavailable, using local baseline:", error instanceof Error ? error.message : "unknown");
    }
  }

  return { vectors: localEmbeddings(texts), model: "hash-384-v2", kind: "hash" };
}

function tokenFromLine(line: string): string | null {
  if (!line.trim()) return null;
  let parsed: { message?: { content?: string }; response?: string; error?: string };
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (parsed.error) throw new Error(parsed.error);
  return parsed.message?.content ?? parsed.response ?? null;
}

async function* streamWithOllama(question: string, contexts: Context[]) {
  const response = await fetch(endpoint("/api/chat"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: chatModel,
      stream: true,
      messages: buildMessages(question, contexts.map(({ text, documentName }) => ({ text, documentName }))),
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok || !response.body) throw new Error(`Generation request failed with ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const token = tokenFromLine(line);
      if (token) yield token;
    }
    if (done) break;
  }

  const token = tokenFromLine(buffer + decoder.decode());
  if (token) yield token;
}

async function* extractiveAnswer(question: string, contexts: Context[]) {
  const answer = answerFromContext(question, contexts);
  for (const token of answer.match(/\S+\s*/g) ?? []) yield token;
}

export async function* streamAnswer(question: string, contexts: Context[]): AsyncGenerator<string> {
  const active = activeChatConfig();
  if (active) {
    yield* streamFromHosted(buildMessages(question, contexts), active);
    return;
  }
  if (chatModel) {
    yield* streamWithOllama(question, contexts);
    return;
  }
  yield* extractiveAnswer(question, contexts);
}

export async function* streamWithFallback(
  question: string,
  contexts: Context[],
  kind: ChatKind
): AsyncGenerator<string> {
  const sources = contexts.map(({ text, documentName }) => ({ text, documentName }));

  if (kind === "hosted") {
    const active = activeChatConfig();
    if (active) {
      try {
        yield* streamFromHosted(buildMessages(question, sources), active);
        return;
      } catch (error) {
        disableChat();
        console.warn("Hosted generation unavailable, using local extraction:", error instanceof Error ? error.message : "unknown");
      }
    }
  }

  if (kind === "ollama" && chatModel) {
    try {
      yield* streamWithOllama(question, contexts);
      return;
    } catch (error) {
      console.warn("Ollama generation unavailable, using local extraction:", error instanceof Error ? error.message : "unknown");
    }
  }

  yield* extractiveAnswer(question, contexts);
}
