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
    expect(provider.embeddingModelName).toBe("hash-384");
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
