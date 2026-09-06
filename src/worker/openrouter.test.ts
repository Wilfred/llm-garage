import assert from "node:assert/strict";
import test from "node:test";
import { OpenRouterWorker } from "./openrouter";
import type { WorkerEvent } from "./types";

void test("sends a conversation to OpenRouter and emits its response", async () => {
  let request:
    { input: string | URL | Request; init?: RequestInit } | undefined;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    request = { input, ...(init ? { init } : {}) };
    return new Response(
      JSON.stringify({
        choices: [
          { message: { role: "assistant", content: "A useful answer" } },
        ],
        usage: { prompt_tokens: 1250, completion_tokens: 42 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  const events: WorkerEvent[] = [];
  const controller = new AbortController();
  const worker = new OpenRouterWorker({
    apiKey: "test-key",
    fetch,
  });

  await worker.run({
    modelId: "anthropic/claude-opus-5",
    modelName: "Claude Opus 5",
    messages: [
      { role: "user", content: "First question" },
      { role: "assistant", content: "First answer" },
      { role: "user", content: "Follow-up question" },
    ],
    signal: controller.signal,
    emit: (event) => events.push(event),
  });

  assert.ok(request);
  assert.equal(request.input, "https://openrouter.ai/api/v1/chat/completions");
  assert.ok(request.init);
  const { init } = request;
  assert.equal(init.method, "POST");
  assert.equal(init.signal, controller.signal);
  const headers = new Headers(init.headers);
  assert.equal(headers.get("Authorization"), "Bearer test-key");
  assert.equal(headers.get("Content-Type"), "application/json");
  assert.equal(headers.get("X-OpenRouter-Title"), "LLM Garage");
  assert.equal(typeof init.body, "string");
  const body: unknown = JSON.parse(init.body as string);
  assert.deepEqual(body, {
    model: "anthropic/claude-opus-5",
    messages: [
      { role: "user", content: "First question" },
      { role: "assistant", content: "First answer" },
      { role: "user", content: "Follow-up question" },
    ],
  });
  assert.deepEqual(events, [
    { kind: "model_output", data: "A useful answer" },
    { kind: "usage", data: "1,250 input tokens · 42 output tokens" },
  ]);
});

void test("reports OpenRouter API errors", async () => {
  const worker = new OpenRouterWorker({
    apiKey: "test-key",
    fetch: async () =>
      new Response(
        JSON.stringify({ error: { message: "Model is unavailable" } }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      ),
  });

  await assert.rejects(
    worker.run({
      modelId: "openai/gpt-5.6-sol",
      modelName: "GPT-5.6 Sol",
      messages: [{ role: "user", content: "Hello" }],
      signal: new AbortController().signal,
      emit: () => undefined,
    }),
    /OpenRouter request failed \(503\): Model is unavailable/,
  );
});

void test("requires an API key before making a request", async () => {
  let called = false;
  const worker = new OpenRouterWorker({
    apiKey: undefined,
    fetch: async () => {
      called = true;
      return new Response();
    },
  });

  await assert.rejects(
    worker.run({
      modelId: "openai/gpt-5.6-sol",
      modelName: "GPT-5.6 Sol",
      messages: [{ role: "user", content: "Hello" }],
      signal: new AbortController().signal,
      emit: () => undefined,
    }),
    /OPENROUTER_API_KEY is not configured/,
  );
  assert.equal(called, false);
});
