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
  assert.deepEqual(
    (body as { model: string; messages: unknown[] }).model,
    "anthropic/claude-opus-5",
  );
  assert.deepEqual((body as { messages: unknown[] }).messages, [
    { role: "user", content: "First question" },
    { role: "assistant", content: "First answer" },
    { role: "user", content: "Follow-up question" },
  ]);
  assert.equal(
    (body as { tools: Array<{ function: { name: string } }> }).tools[0]
      ?.function.name,
    "run_command",
  );
  assert.deepEqual(
    (body as { tools: Array<{ function: { name: string } }> }).tools.map(
      (tool) => tool.function.name,
    ),
    ["run_command", "fetch_url", "search_web"],
  );
  assert.deepEqual(events, [
    { kind: "model_output", data: "A useful answer" },
    { kind: "usage", data: "1,250 input tokens · 42 output tokens" },
  ]);
});

void test("fetches URLs and searches Brave when requested by the model", async () => {
  const responses = [
    {
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "fetch-1",
                type: "function",
                function: {
                  name: "fetch_url",
                  arguments: JSON.stringify({ url: "https://example.com" }),
                },
              },
              {
                id: "search-1",
                type: "function",
                function: {
                  name: "search_web",
                  arguments: JSON.stringify({ query: "example", count: 2 }),
                },
              },
            ],
          },
        },
      ],
    },
    { choices: [{ message: { content: "Research complete." } }] },
  ];
  const calls: string[] = [];
  const requests: unknown[] = [];
  const events: WorkerEvent[] = [];
  const worker = new OpenRouterWorker({
    apiKey: "test-key",
    fetch: async (_input, init) => {
      requests.push(JSON.parse(init?.body as string));
      return Response.json(responses.shift());
    },
    webTools: {
      fetchUrl: async (url) => {
        calls.push(`fetch ${url}`);
        return {
          url,
          status: 200,
          contentType: "text/plain",
          content: "Example page",
          truncated: false,
        };
      },
      searchWeb: async (query, count) => {
        calls.push(`search ${query} ${count.toString()}`);
        return {
          query,
          results: [
            {
              title: "Example",
              url: "https://example.com",
              description: "A result",
            },
          ],
        };
      },
    },
  });

  await worker.run({
    modelId: "openai/gpt-5.6-sol",
    modelName: "GPT-5.6 Sol",
    messages: [{ role: "user", content: "Research example.com" }],
    signal: new AbortController().signal,
    emit: (event) => events.push(event),
  });

  assert.deepEqual(calls, ["fetch https://example.com", "search example 2"]);
  assert.equal(requests.length, 2);
  const followUp = requests[1] as {
    messages: Array<{ role: string; tool_call_id?: string; content: string }>;
  };
  assert.deepEqual(
    followUp.messages.slice(-2).map(({ role, tool_call_id }) => ({
      role,
      tool_call_id,
    })),
    [
      { role: "tool", tool_call_id: "fetch-1" },
      { role: "tool", tool_call_id: "search-1" },
    ],
  );
  assert.deepEqual(
    events.map(({ kind }) => kind),
    ["tool", "tool", "tool", "tool", "model_output"],
  );
  assert.match(events[1]?.data ?? "", /Example page/);
  assert.match(events[3]?.data ?? "", /A result/);
});

void test("runs model-requested shell commands and returns their output", async () => {
  const requests: unknown[] = [];
  const responses = [
    {
      choices: [
        {
          message: {
            content: "I'll inspect the container.",
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: {
                  name: "run_command",
                  arguments: JSON.stringify({ command: "ls /" }),
                },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          message: {
            content: "The root contains bin and workspace.",
          },
        },
      ],
    },
  ];
  const worker = new OpenRouterWorker({
    apiKey: "test-key",
    fetch: async (_input, init) => {
      requests.push(JSON.parse(init?.body as string));
      return Response.json(responses.shift());
    },
  });
  const commands: string[] = [];
  const events: WorkerEvent[] = [];

  await worker.run({
    modelId: "openai/gpt-5.6-sol",
    modelName: "GPT-5.6 Sol",
    messages: [{ role: "user", content: "List the container root" }],
    signal: new AbortController().signal,
    runCommand: async (command) => {
      commands.push(command);
      return {
        exitCode: 0,
        stdout: "bin\nworkspace\n",
        stderr: "",
        truncated: false,
      };
    },
    emit: (event) => events.push(event),
  });

  assert.deepEqual(commands, ["ls /"]);
  assert.equal(requests.length, 2);
  const secondRequest = requests[1] as {
    messages: Array<Record<string, unknown>>;
  };
  assert.deepEqual(secondRequest.messages.at(-1), {
    role: "tool",
    tool_call_id: "call-1",
    content: JSON.stringify({
      exitCode: 0,
      stdout: "bin\nworkspace\n",
      stderr: "",
      truncated: false,
    }),
  });
  assert.deepEqual(
    events.map(({ kind }) => kind),
    ["model_output", "tool", "tool", "model_output"],
  );
  assert.match(events[2]?.data ?? "", /bin\\nworkspace/);
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
