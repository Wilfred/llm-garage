import { randomUUID } from "node:crypto";
import { EventSourceParserStream } from "eventsource-parser/stream";
import { z } from "zod";
import type { ChatGptCredentialSource } from "../chatgpt/auth";
import { formatUsage, type TokenUsage } from "../usage";
import { agentTools, codingAgentPrompt, runAgentTool } from "./agent-tools";
import type {
  ConversationMessage,
  ToolCall,
  TrajectoryWorker,
  WorkerContext,
} from "./types";
import type { WebToolProvider } from "./web-tools";

const defaultEndpoint = "https://chatgpt.com/backend-api/codex/responses";

// Responses API items are passed back to the model as they came, so the
// reasoning it produced earlier in the turn is kept.
type ResponseItem = { type: string } & Record<string, unknown>;

const responseItemSchema = z.looseObject({ type: z.string() });

const messageItemSchema = z.object({
  type: z.literal("message"),
  content: z.array(
    z.looseObject({ type: z.string(), text: z.string().optional() }),
  ),
});

const functionCallItemSchema = z.object({
  type: z.literal("function_call"),
  call_id: z.string(),
  name: z.string(),
  arguments: z.string(),
});

const streamEventSchema = z.looseObject({
  type: z.string(),
  item: z.unknown().optional(),
  message: z.string().optional(),
  response: z
    .looseObject({
      usage: z
        .object({
          input_tokens: z.number().int().nonnegative(),
          output_tokens: z.number().int().nonnegative(),
        })
        .nullish(),
      error: z.object({ message: z.string() }).nullish(),
      incomplete_details: z.object({ reason: z.string() }).nullish(),
    })
    .optional(),
});

const errorSchema = z.union([
  z.object({ error: z.object({ message: z.string() }) }),
  z.object({ detail: z.string() }).transform(({ detail }) => ({
    error: { message: detail },
  })),
]);

const tools = agentTools.map(({ function: tool }) => ({
  type: "function",
  name: tool.name,
  description: tool.description,
  parameters: tool.parameters,
  strict: false,
}));

export type ChatGptWorkerOptions = {
  auth: ChatGptCredentialSource;
  endpoint?: string;
  fetch?: typeof fetch;
  webTools?: WebToolProvider;
};

export class ChatGptWorker implements TrajectoryWorker {
  private readonly auth: ChatGptCredentialSource;
  private readonly endpoint: string;
  private readonly fetch: typeof fetch;
  private readonly webTools: WebToolProvider | undefined;

  constructor({
    auth,
    endpoint = defaultEndpoint,
    fetch: fetchImplementation = fetch,
    webTools,
  }: ChatGptWorkerOptions) {
    this.auth = auth;
    this.endpoint = endpoint;
    this.fetch = fetchImplementation;
    this.webTools = webTools;
  }

  async run(context: WorkerContext): Promise<void> {
    const input = context.messages.flatMap(toResponseItems);
    const promptCacheKey = randomUUID();
    for (;;) {
      const { items, usage } = await this.respond(
        input,
        context,
        promptCacheKey,
      );
      const text: string[] = [];
      const toolCalls: ToolCall[] = [];
      for (const item of items) {
        // Items are not stored server side, so their ids cannot be referenced.
        const { id: _id, ...replayed } = item;
        input.push(replayed);
        const message = messageItemSchema.safeParse(item);
        if (message.success) {
          for (const part of message.data.content) {
            if (part.type === "output_text" && part.text) text.push(part.text);
          }
        }
        const call = functionCallItemSchema.safeParse(item);
        if (call.success) {
          toolCalls.push({
            id: call.data.call_id,
            type: "function",
            function: { name: call.data.name, arguments: call.data.arguments },
          });
        }
      }
      const content = text.join("\n\n");

      if (content.trim()) {
        context.emit({ kind: "model_output", data: content });
      }
      if (usage) {
        context.emit({ kind: "usage", data: formatUsage(usage), usage });
      }
      if (!toolCalls.length) {
        if (!content.trim()) {
          throw new Error("ChatGPT returned an empty response");
        }
        context.appendMessage({ role: "assistant", content });
        return;
      }

      context.appendMessage({
        role: "assistant",
        content: content || null,
        tool_calls: toolCalls,
      });
      for (const toolCall of toolCalls) {
        const output = await runAgentTool(toolCall, context, this.webTools);
        input.push({
          type: "function_call_output",
          call_id: toolCall.id,
          output,
        });
        context.appendMessage({
          role: "tool",
          tool_call_id: toolCall.id,
          content: output,
        });
      }
    }
  }

  private async respond(
    input: ResponseItem[],
    context: WorkerContext,
    promptCacheKey: string,
    forceRefresh = false,
  ): Promise<{ items: ResponseItem[]; usage?: TokenUsage }> {
    const credentials = await this.auth.credentials(context.signal, {
      forceRefresh,
    });
    const response = await this.fetch(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        ...(credentials.accountId === undefined
          ? {}
          : { "ChatGPT-Account-ID": credentials.accountId }),
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        originator: "llm-garage",
      },
      body: JSON.stringify({
        model: context.modelId,
        instructions: codingAgentPrompt,
        input,
        tools,
        tool_choice: "auto",
        parallel_tool_calls: true,
        reasoning: { effort: context.effort },
        store: false,
        stream: true,
        include: ["reasoning.encrypted_content"],
        prompt_cache_key: promptCacheKey,
      }),
      signal: context.signal,
    });

    if (response.status === 401 && !forceRefresh) {
      await response.body?.cancel();
      return this.respond(input, context, promptCacheKey, true);
    }
    if (!response.ok || !response.body) {
      const body: unknown = await response.json().catch(() => undefined);
      const error = errorSchema.safeParse(body);
      const detail = error.success ? `: ${error.data.error.message}` : "";
      throw new Error(
        `ChatGPT request failed (${response.status.toString()})${detail}`,
      );
    }

    const items: ResponseItem[] = [];
    const events = response.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new EventSourceParserStream());
    for await (const { data } of events) {
      const event = streamEventSchema.parse(JSON.parse(data));
      switch (event.type) {
        case "response.output_item.done":
          items.push(responseItemSchema.parse(event.item));
          break;
        case "response.completed": {
          const usage = event.response?.usage;
          return {
            items,
            ...(usage
              ? {
                  usage: {
                    inputTokens: usage.input_tokens,
                    outputTokens: usage.output_tokens,
                    // Covered by the subscription rather than billed per token.
                    costUsd: 0,
                  },
                }
              : {}),
          };
        }
        case "response.failed":
          throw new Error(
            `ChatGPT response failed: ${event.response?.error?.message ?? "unknown error"}`,
          );
        case "response.incomplete":
          throw new Error(
            `ChatGPT response incomplete: ${event.response?.incomplete_details?.reason ?? "unknown reason"}`,
          );
        case "error":
          throw new Error(`ChatGPT error: ${event.message ?? "unknown error"}`);
      }
    }
    throw new Error("ChatGPT response ended before it completed");
  }
}

// Conversations are stored in the chat completions format, so convert them to
// Responses API input items.
function toResponseItems(message: ConversationMessage): ResponseItem[] {
  switch (message.role) {
    case "system":
    case "user":
      return [
        {
          type: "message",
          role: message.role === "system" ? "developer" : "user",
          content: [{ type: "input_text", text: message.content }],
        },
      ];
    case "assistant":
      return [
        ...(message.content
          ? [
              {
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: message.content }],
              },
            ]
          : []),
        ...("tool_calls" in message ? message.tool_calls : []).map(
          (toolCall) => ({
            type: "function_call",
            call_id: toolCall.id,
            name: toolCall.function.name,
            arguments: toolCall.function.arguments,
          }),
        ),
      ];
    case "tool":
      return [
        {
          type: "function_call_output",
          call_id: message.tool_call_id,
          output: message.content,
        },
      ];
  }
}
