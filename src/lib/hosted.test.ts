import { afterEach, describe, expect, it, vi } from "vitest";
import {
  embedWithHosted,
  hostedConfig,
  streamFromHosted,
  validateVectors,
  type HostedConfig,
} from "./hosted";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const config: HostedConfig = {
  apiKey: "sk-test-secret",
  chatBaseUrl: "https://api.example.com/v1",
  embedBaseUrl: "https://api.example.com/v1",
  model: "test-model",
  embedModel: "test-embed",
};

describe("hostedConfig", () => {
  it("ignores unset and placeholder keys", () => {
    vi.stubEnv("LLM_API_KEY", "");
    expect(hostedConfig()).toBeNull();
    vi.stubEnv("LLM_API_KEY", "your-api-key-here");
    expect(hostedConfig()).toBeNull();
  });

  it("uses defaults and honours overrides", () => {
    vi.stubEnv("LLM_API_KEY", "sk-real-key");
    expect(hostedConfig()).toEqual({
      apiKey: "sk-real-key",
      chatBaseUrl: "https://api.openai.com/v1",
      embedBaseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      embedModel: "text-embedding-3-small",
    });
    vi.stubEnv("LLM_BASE_URL", "https://groq.example.com/openai/v1/");
    vi.stubEnv("LLM_MODEL", "llama-3.3-70b-versatile");
    const resolved = hostedConfig()!;
    expect(resolved.chatBaseUrl).toBe("https://groq.example.com/openai/v1");
    expect(resolved.embedBaseUrl).toBe("https://groq.example.com/openai/v1");
    expect(resolved.model).toBe("llama-3.3-70b-versatile");
  });

  it("disables hosted embeddings when LLM_EMBED_MODEL is none", () => {
    vi.stubEnv("LLM_API_KEY", "gsk-test");
    vi.stubEnv("LLM_EMBED_MODEL", "none");
    expect(hostedConfig()?.embedModel).toBeNull();
    expect(hostedConfig()?.model).toBe("gpt-4o-mini");
  });

  it("allows a separate embeddings base URL", () => {
    vi.stubEnv("LLM_API_KEY", "sk-real-key");
    vi.stubEnv("LLM_EMBED_BASE_URL", "https://embed.example.com/v1/");
    expect(hostedConfig()?.embedBaseUrl).toBe("https://embed.example.com/v1");
  });
});

describe("validateVectors", () => {
  it("accepts consistent finite vectors", () => {
    expect(validateVectors([[0.1, 0.2], [0.3, 0.4]], 2)).toEqual([[0.1, 0.2], [0.3, 0.4]]);
  });

  it("rejects wrong counts, bad values and mixed dimensions", () => {
    expect(() => validateVectors([[1]], 2)).toThrow("did not match");
    expect(() => validateVectors([["bad"]], 1)).toThrow("invalid vector");
    expect(() => validateVectors([[1], [1, 2]], 2)).toThrow("different dimensions");
  });
});

describe("embedWithHosted", () => {
  it("calls the embeddings endpoint with the key in a header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(await embedWithHosted(["hello"], config)).toEqual([[0.1, 0.2]]);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/v1/embeddings");
    expect(options.headers.Authorization).toBe("Bearer sk-test-secret");
    expect(JSON.parse(options.body)).toEqual({ model: "test-embed", input: ["hello"] });
  });

  it("refuses to call embeddings when disabled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(embedWithHosted(["hello"], { ...config, embedModel: null })).rejects.toThrow("disabled");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("streamFromHosted", () => {
  it("streams content from SSE data events and stops at DONE", async () => {
    const body = [
      'data: {"choices":[{"delta":{"content":"Atlas "}}]}',
      "",
      'data: {"choices":[{"delta":{"content":"is a platform."}}]}',
      "",
      "data: [DONE]",
      "",
      'data: {"choices":[{"delta":{"content":"ignored"}}]}',
      "",
    ].join("\n");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200 })));

    let answer = "";
    for await (const token of streamFromHosted([{ role: "user", content: "question" }], config)) {
      answer += token;
    }
    expect(answer).toBe("Atlas is a platform.");
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("https://api.example.com/v1/chat/completions");
  });

  it("handles CRLF framing and surfaces API errors", async () => {
    const body = 'data: {"error":{"message":"quota exceeded"}}\r\n\r\n';
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200 })));

    const iterator = streamFromHosted([{ role: "user", content: "question" }], config);
    await expect(iterator.next()).rejects.toThrow("quota exceeded");
  });
});
