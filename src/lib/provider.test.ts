import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

function enableOllama() {
  vi.stubEnv("OLLAMA_MODEL", "llama3.2");
  vi.stubEnv("OLLAMA_HOST", "http://localhost:11434");
  vi.resetModules();
}

describe("default provider", () => {
  it("embeds locally and streams an extractive answer", async () => {
    vi.resetModules();
    const provider = await import("./provider");

    expect(provider.usesOllama()).toBe(false);
    expect(provider.embeddingModelName).toBe("hash-384-v2");
    expect((await provider.embedTexts(["Atlas retrieval"]))[0]).toHaveLength(384);

    let answer = "";
    for await (const token of provider.streamAnswer("What is Atlas?", [
      { text: "Atlas is a platform for research notes.", documentName: "Atlas.md" },
    ])) {
      answer += token;
    }
    expect(answer).toContain("Atlas is a platform");
  });
});

describe("hosted provider takes priority", () => {
  it("uses the hosted API for embeddings and generation even when Ollama is configured", async () => {
    vi.stubEnv("LLM_API_KEY", "sk-test-secret");
    vi.stubEnv("LLM_BASE_URL", "https://api.example.com/v1");
    vi.stubEnv("LLM_MODEL", "hosted-model");
    vi.stubEnv("LLM_EMBED_MODEL", "hosted-embed");
    vi.stubEnv("OLLAMA_MODEL", "llama3.2");
    vi.resetModules();

    const embedMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }), { status: 200 })
    );
    const chatMock = vi.fn().mockResolvedValue(
      new Response('data: {"choices":[{"delta":{"content":"Hosted answer."}}]}\n\ndata: [DONE]\n\n', { status: 200 })
    );
    vi.stubGlobal("fetch", vi.fn((url: string) => url.includes("embeddings") ? embedMock() : chatMock()));

    const provider = await import("./provider");
    expect(provider.usesHosted()).toBe(true);
    expect(provider.usesOllama()).toBe(false);
    expect(provider.embeddingModelName).toBe("api:hosted-embed");
    expect(await provider.embedTexts(["question"])).toEqual([[0.1, 0.2]]);

    let answer = "";
    for await (const token of provider.streamAnswer("Question?", [
      { text: "Atlas is a platform.", documentName: "Atlas.md" },
    ])) {
      answer += token;
    }
    expect(answer).toBe("Hosted answer.");
    expect(chatMock).toHaveBeenCalledOnce();
  });

  it("falls back to Ollama when the API key is a placeholder", async () => {
    vi.stubEnv("LLM_API_KEY", "your-api-key-here");
    vi.stubEnv("OLLAMA_MODEL", "llama3.2");
    vi.resetModules();
    const provider = await import("./provider");
    expect(provider.usesHosted()).toBe(false);
    expect(provider.usesOllama()).toBe(true);
    expect(provider.embeddingModelName).toBe("nomic-embed-text");
  });
});

describe("provider fallback", () => {
  it("uses the local baseline when the hosted API rejects the key", async () => {
    vi.stubEnv("LLM_API_KEY", "sk-invalid-key");
    vi.stubEnv("LLM_BASE_URL", "https://api.example.com/v1");
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 })));

    const provider = await import("./provider");
    const embedded = await provider.embedWithFallback(["Atlas retrieval"]);
    expect(embedded.kind).toBe("hash");
    expect(embedded.model).toBe("hash-384-v2");
    expect(embedded.vectors[0]).toHaveLength(384);

    let answer = "";
    for await (const token of provider.streamWithFallback("What is Atlas?", [
      { text: "Atlas is a platform for research notes.", documentName: "Atlas.md" },
    ], embedded.kind)) {
      answer += token;
    }
    expect(answer).toContain("Atlas is a platform");
  });

  it("uses Ollama when hosted fails and Ollama is configured", async () => {
    vi.stubEnv("LLM_API_KEY", "sk-invalid-key");
    vi.stubEnv("LLM_BASE_URL", "https://api.example.com/v1");
    vi.stubEnv("OLLAMA_MODEL", "llama3.2");
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ embeddings: [[0.1, 0.2]] }), { status: 200 })));

    const provider = await import("./provider");
    const embedded = await provider.embedWithFallback(["Atlas"]);
    expect(embedded.kind).toBe("ollama");
    expect(embedded.vectors).toEqual([[0.1, 0.2]]);
  });
});

describe("chat-only hosted provider (Groq style)", () => {
  it("uses local embeddings but sends generation to the hosted chat API", async () => {
    vi.stubEnv("LLM_API_KEY", "gsk-test-key");
    vi.stubEnv("LLM_BASE_URL", "https://api.groq.com/openai/v1");
    vi.stubEnv("LLM_MODEL", "llama-3.3-70b-versatile");
    vi.stubEnv("LLM_EMBED_MODEL", "none");
    vi.resetModules();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('data: {"choices":[{"delta":{"content":"Groq answer."}}]}\n\ndata: [DONE]\n\n', { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = await import("./provider");
    expect(provider.embeddingModelName).toBe("hash-384-v2");
    expect(provider.activeChatKind()).toBe("hosted");

    const embedded = await provider.embedWithFallback(["Atlas"]);
    expect(embedded.kind).toBe("hash");
    expect(fetchMock).not.toHaveBeenCalled();

    let answer = "";
    for await (const token of provider.streamWithFallback("Question?", [
      { text: "Atlas is a platform.", documentName: "Atlas.md" },
    ], provider.activeChatKind())) {
      answer += token;
    }
    expect(answer).toBe("Groq answer.");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(options.headers.Authorization).toBe("Bearer gsk-test-key");
    expect(JSON.parse(options.body).model).toBe("llama-3.3-70b-versatile");
  });
});

describe("Ollama provider", () => {
  it("embeds through the Ollama API", async () => {
    enableOllama();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ embeddings: [[0.1, 0.2]] }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = await import("./provider");
    expect(provider.embeddingModelName).toBe("nomic-embed-text");
    expect(await provider.embedTexts(["hello"])).toEqual([[0.1, 0.2]]);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:11434/api/embed",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("rejects invalid embedding vectors", async () => {
    enableOllama();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ embeddings: [["bad", null]] }), { status: 200 })
    ));
    const provider = await import("./provider");
    await expect(provider.embedTexts(["hello"])).rejects.toThrow("invalid vector");
  });

  it("streams tokens from chat NDJSON, including the final unterminated line", async () => {
    enableOllama();
    const body = [
      '{"model":"llama3.2","message":{"role":"assistant","content":"Atlas "},"done":false}',
      "not json",
      '{"model":"llama3.2","message":{"role":"assistant","content":"is a platform."},"done":true}',
    ].join("\n");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200 })));

    const provider = await import("./provider");
    let answer = "";
    for await (const token of provider.streamAnswer("What is Atlas?", [
      { text: "Atlas is a platform.", documentName: "Atlas.md" },
    ])) {
      answer += token;
    }
    expect(answer).toBe("Atlas is a platform.");
  });

  it("also accepts the generate endpoint response shape", async () => {
    enableOllama();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response('{"response":"Legacy shape"}', { status: 200 })
    ));
    const provider = await import("./provider");
    let answer = "";
    for await (const token of provider.streamAnswer("Question", [])) answer += token;
    expect(answer).toBe("Legacy shape");
  });
});
