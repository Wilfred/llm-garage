import assert from "node:assert/strict";
import test from "node:test";
import type { ChatGptCredentialSource } from "../chatgpt/auth";
import { ChatGptWorker } from "./chatgpt";
import type { ConversationMessage, WorkerContext, WorkerEvent } from "./types";

function sse(events: Array<{ type: string } & Record<string, unknown>>) {
  return new Response(
    events
      .map(
        (event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
      )
      .join(""),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

function completed(inputTokens: number, outputTokens: number) {
  return {
    type: "response.completed",
    response: {
      id: "resp_1",
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    },
  };
}

const credentials: ChatGptCredentialSource = {
  credentials: async () => ({ accessToken: "access", accountId: "account" }),
};

function context(
  overrides: Partial<WorkerContext> = {},
): WorkerContext & { events: WorkerEvent[]; appended: ConversationMessage[] } {
  const events: WorkerEvent[] = [];
  const appended: ConversationMessage[] = [];
  return {
    modelId: "gpt-5.5",
    modelName: "GPT-5.5",
    provider: "chatgpt",
    effort: "high",
    messages: [{ role: "user", content: "List the files" }],
    signal: new AbortController().signal,
    emit: (event) => events.push(event),
    appendMessage: (message) => appended.push(message),
    events,
    appended,
    ...overrides,
  };
}

void test("runs tools through the Codex backend and keeps reasoning in the turn", async () => {
  const requests: Array<{ url: string; headers: Headers; body: unknown }> = [];
  const responses = [
    sse([
      {
        type: "response.output_item.done",
        item: {
          id: "rs_1",
          type: "reasoning",
          summary: [],
          encrypted_content: "secret",
        },
      },
      {
        type: "response.output_item.done",
        item: {
          id: "fc_1",
          type: "function_call",
          call_id: "call_1",
          name: "run_command",
          arguments: JSON.stringify({ command: "ls" }),
        },
      },
      completed(100, 20),
    ]),
    sse([
      { type: "response.output_text.delta", delta: "Two" },
      {
        type: "response.output_item.done",
        item: {
          id: "msg_1",
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Two files." }],
        },
      },
      completed(150, 5),
    ]),
  ];
  const worker = new ChatGptWorker({
    auth: credentials,
    fetch: async (input, init) => {
      requests.push({
        url: input as string,
        headers: new Headers(init?.headers),
        body: JSON.parse(init?.body as string),
      });
      const response = responses.shift();
      assert.ok(response);
      return response;
    },
  });
  const run = context({
    runCommand: async () => ({
      exitCode: 0,
      stdout: "a\nb\n",
      stderr: "",
      truncated: false,
      timedOut: false,
    }),
  });

  await worker.run(run);

  assert.equal(requests.length, 2);
  const [first, second] = requests;
  assert.ok(first && second);
  assert.equal(first.url, "https://chatgpt.com/backend-api/codex/responses");
  assert.equal(first.headers.get("Authorization"), "Bearer access");
  assert.equal(first.headers.get("ChatGPT-Account-ID"), "account");
  const body = first.body as {
    model: string;
    instructions: string;
    input: unknown[];
    tools: Array<{ type: string; name: string }>;
    reasoning: unknown;
    store: boolean;
    stream: boolean;
    include: string[];
  };
  assert.equal(body.model, "gpt-5.5");
  assert.match(body.instructions, /set_trajectory_name/);
  assert.deepEqual(body.input, [
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "List the files" }],
    },
  ]);
  assert.deepEqual(
    body.tools.map(({ type, name }) => `${type}:${name}`),
    [
      "function:set_trajectory_name",
      "function:garage_settings",
      "function:run_command",
      "function:fetch_url",
      "function:search_web",
    ],
  );
  assert.deepEqual(body.reasoning, { effort: "high" });
  assert.equal(body.store, false);
  assert.equal(body.stream, true);
  assert.deepEqual(body.include, ["reasoning.encrypted_content"]);

  const secondInput = (second.body as { input: unknown[] }).input;
  assert.deepEqual(secondInput.slice(1), [
    { type: "reasoning", summary: [], encrypted_content: "secret" },
    {
      type: "function_call",
      call_id: "call_1",
      name: "run_command",
      arguments: JSON.stringify({ command: "ls" }),
    },
    {
      type: "function_call_output",
      call_id: "call_1",
      output: JSON.stringify({
        exitCode: 0,
        stdout: "a\nb\n",
        stderr: "",
        truncated: false,
        timedOut: false,
      }),
    },
  ]);

  assert.deepEqual(run.appended, [
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: {
            name: "run_command",
            arguments: JSON.stringify({ command: "ls" }),
          },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "call_1",
      content: JSON.stringify({
        exitCode: 0,
        stdout: "a\nb\n",
        stderr: "",
        truncated: false,
        timedOut: false,
      }),
    },
    { role: "assistant", content: "Two files." },
  ]);
  assert.deepEqual(
    run.events.filter(({ kind }) => kind !== "tool"),
    [
      {
        kind: "usage",
        data: "100 input tokens · 20 output tokens · $0.00",
        usage: { inputTokens: 100, outputTokens: 20, costUsd: 0 },
      },
      { kind: "model_output", data: "Two files." },
      {
        kind: "usage",
        data: "150 input tokens · 5 output tokens · $0.00",
        usage: { inputTokens: 150, outputTokens: 5, costUsd: 0 },
      },
    ],
  );
});

void test("replays a persisted conversation as Responses input", async () => {
  let input: unknown;
  const worker = new ChatGptWorker({
    auth: credentials,
    fetch: async (_url, init) => {
      input = (JSON.parse(init?.body as string) as { input: unknown }).input;
      return sse([
        {
          type: "response.output_item.done",
          item: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Done." }],
          },
        },
        completed(1, 1),
      ]);
    },
  });

  await worker.run(
    context({
      messages: [
        { role: "user", content: "Name it" },
        {
          role: "assistant",
          content: "Naming.",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "set_trajectory_name", arguments: "{}" },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: "{}" },
        { role: "user", content: "Carry on" },
      ],
    }),
  );

  assert.deepEqual(input, [
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Name it" }],
    },
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Naming." }],
    },
    {
      type: "function_call",
      call_id: "call_1",
      name: "set_trajectory_name",
      arguments: "{}",
    },
    { type: "function_call_output", call_id: "call_1", output: "{}" },
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Carry on" }],
    },
  ]);
});

void test("refreshes the sign-in once when the backend rejects it", async () => {
  const refreshes: boolean[] = [];
  const worker = new ChatGptWorker({
    auth: {
      credentials: async (_signal, options) => {
        refreshes.push(options?.forceRefresh ?? false);
        return { accessToken: options?.forceRefresh ? "fresh" : "stale" };
      },
    },
    fetch: async (_url, init) => {
      const headers = new Headers(init?.headers);
      if (headers.get("Authorization") === "Bearer stale") {
        return new Response("", { status: 401 });
      }
      assert.equal(headers.get("ChatGPT-Account-ID"), null);
      return sse([
        {
          type: "response.output_item.done",
          item: {
            type: "message",
            content: [{ type: "output_text", text: "Hi" }],
          },
        },
        completed(1, 1),
      ]);
    },
  });

  await worker.run(context());

  assert.deepEqual(refreshes, [false, true]);
});

void test("reports failed responses and request errors", async () => {
  const failed = new ChatGptWorker({
    auth: credentials,
    fetch: async () =>
      sse([
        {
          type: "response.failed",
          response: { error: { message: "Usage limit reached" } },
        },
      ]),
  });
  await assert.rejects(failed.run(context()), {
    message: "ChatGPT response failed: Usage limit reached",
  });

  const rejected = new ChatGptWorker({
    auth: credentials,
    fetch: async () =>
      Response.json({ detail: "Unsupported model" }, { status: 400 }),
  });
  await assert.rejects(rejected.run(context()), {
    message: "ChatGPT request failed (400): Unsupported model",
  });

  const truncated = new ChatGptWorker({
    auth: credentials,
    fetch: async () => sse([{ type: "response.created", response: {} }]),
  });
  await assert.rejects(truncated.run(context()), {
    message: "ChatGPT response ended before it completed",
  });
});
