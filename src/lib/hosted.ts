export type HostedConfig = {
  apiKey: string;
  chatBaseUrl: string;
  embedBaseUrl: string;
  model: string;
  embedModel: string | null;
};

function isPlaceholder(value: string) {
  return /^(your|replace|change|placeholder|todo)/i.test(value.trim());
}

function disabledEmbeddings(value: string | undefined) {
  return !value || /^(none|off|disabled|local)$/i.test(value.trim());
}

export function hostedConfig(): HostedConfig | null {
  const apiKey = process.env.LLM_API_KEY?.trim();
  if (!apiKey || isPlaceholder(apiKey)) return null;

  const chatBaseUrl = (process.env.LLM_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const embedBaseUrl = (process.env.LLM_EMBED_BASE_URL ?? chatBaseUrl).replace(/\/$/, "");
  const rawEmbedModel = process.env.LLM_EMBED_MODEL ?? "text-embedding-3-small";

  return {
    apiKey,
    chatBaseUrl,
    embedBaseUrl,
    model: process.env.LLM_MODEL ?? "gpt-4o-mini",
    embedModel: disabledEmbeddings(rawEmbedModel) ? null : rawEmbedModel,
  };
}

export function validateVectors(values: unknown[], expectedCount: number): number[][] {
  if (!Array.isArray(values) || values.length !== expectedCount) {
    throw new Error("Embedding response did not match the input");
  }

  let dimensions = 0;
  for (const vector of values) {
    if (!Array.isArray(vector) || vector.length === 0 ||
        vector.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
      throw new Error("Embedding response contained an invalid vector");
    }
    if (dimensions && vector.length !== dimensions) {
      throw new Error("Embedding vectors have different dimensions");
    }
    dimensions = vector.length;
  }
  return values as number[][];
}

export async function embedWithHosted(texts: string[], config: HostedConfig): Promise<number[][]> {
  if (!config.embedModel) throw new Error("Hosted embeddings are disabled");

  const response = await fetch(`${config.embedBaseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({ model: config.embedModel, input: texts }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Embedding request failed with ${response.status}`);

  const data = (await response.json()) as { data?: Array<{ embedding?: unknown }> };
  return validateVectors((data.data ?? []).map((item) => item.embedding), texts.length);
}

function tokensFromEvent(event: string) {
  const tokens: string[] = [];
  for (const line of event.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    let parsed: {
      choices?: Array<{ delta?: { content?: string } }>;
      error?: { message?: string };
    };
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue;
    }
    if (parsed.error?.message) throw new Error(parsed.error.message);
    const content = parsed.choices?.[0]?.delta?.content;
    if (content) tokens.push(content);
  }
  return tokens;
}

export async function* streamFromHosted(
  messages: Array<{ role: string; content: string }>,
  config: HostedConfig
): AsyncGenerator<string> {
  const response = await fetch(`${config.chatBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({ model: config.model, stream: true, messages }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok || !response.body) throw new Error(`Generation request failed with ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;

  while (!finished) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const event = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      if (event.includes("[DONE]")) finished = true;
      for (const token of tokensFromEvent(event)) yield token;
      boundary = buffer.indexOf("\n\n");
    }
    if (done) break;
  }

  if (!finished && buffer.trim()) {
    for (const token of tokensFromEvent(buffer)) yield token;
  }
}
