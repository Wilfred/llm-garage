import { z } from "zod";
import { formatUsage, type TokenUsage } from "../usage";
import { agentTools, codingAgentPrompt, runAgentTool } from "./agent-tools";
import type {
  ConversationMessage,
  TrajectoryWorker,
  WorkerContext,
} from "./types";
import type { WebToolProvider } from "./web-tools";

const defaultEndpoint = "https://openrouter.ai/api/v1/chat/completions";

const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable(),
          tool_calls: z
            .array(
              z.object({
                id: z.string(),
                type: z.literal("function"),
                function: z.object({
                  name: z.string(),
                  arguments: z.string(),
                }),
              }),
            )
            .optional(),
        }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative(),
      completion_tokens: z.number().int().nonnegative(),
      cost: z.number().nonnegative().optional(),
    })
    .optional(),
});

const errorSchema = z.object({
  error: z.object({ message: z.string() }),
});

export type OpenRouterWorkerOptions = {
  apiKey: string | undefined;
  endpoint?: string;
  fetch?: typeof fetch;
  webTools?: WebToolProvider;
};

export class OpenRouterWorker implements TrajectoryWorker {
  private readonly apiKey: string | undefined;
  private readonly endpoint: string;
  private readonly fetch: typeof fetch;
  private readonly webTools: WebToolProvider | undefined;

  constructor({
    apiKey,
    endpoint = defaultEndpoint,
    fetch: fetchImplementation = fetch,
    webTools,
  }: OpenRouterWorkerOptions) {
    this.apiKey = apiKey;
    this.endpoint = endpoint;
    this.fetch = fetchImplementation;
    this.webTools = webTools;
  }

  async run(context: WorkerContext): Promise<void> {
    if (!this.apiKey) {
      throw new Error("OPENROUTER_API_KEY is not configured");
    }

    // The system prompt is rebuilt each run rather than persisted, so a
    // resumed turn picks up the current one.
    const messages: ConversationMessage[] = [
      { role: "system", content: codingAgentPrompt },
      ...context.messages,
    ];
    const append = (message: ConversationMessage): void => {
      messages.push(message);
      context.appendMessage(message);
    };
    for (;;) {
      const completion = await this.complete(messages, context);
      const message = completion.choices[0]?.message;
      if (!message) throw new Error("OpenRouter returned an empty completion");

      if (message.content?.trim()) {
        context.emit({ kind: "model_output", data: message.content });
      }
      if (completion.usage) {
        const usage: TokenUsage = {
          inputTokens: completion.usage.prompt_tokens,
          outputTokens: completion.usage.completion_tokens,
          ...(completion.usage.cost === undefined
            ? {}
            : { costUsd: completion.usage.cost }),
        };
        context.emit({ kind: "usage", data: formatUsage(usage), usage });
      }
      if (!message.tool_calls?.length) {
        if (!message.content?.trim()) {
          throw new Error("OpenRouter returned an empty chat completion");
        }
        append({ role: "assistant", content: message.content });
        return;
      }

      append({
        role: "assistant",
        content: message.content,
        tool_calls: message.tool_calls,
      });
      for (const toolCall of message.tool_calls) {
        const result = await runAgentTool(toolCall, context, this.webTools);
        append({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        });
      }
    }
  }

  private async complete(
    messages: ConversationMessage[],
    context: WorkerContext,
  ): Promise<z.infer<typeof completionSchema>> {
    const response = await this.fetch(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey ?? ""}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/Wilfred/llm-garage",
        "X-OpenRouter-Title": "LLM Garage",
      },
      body: JSON.stringify({
        model: context.modelId,
        reasoning: { effort: context.effort },
        messages,
        tools: agentTools,
        usage: { include: true },
      }),
      signal: context.signal,
    });

    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const error = errorSchema.safeParse(body);
      const detail = error.success ? `: ${error.data.error.message}` : "";
      throw new Error(
        `OpenRouter request failed (${response.status.toString()})${detail}`,
      );
    }

    const completion = completionSchema.safeParse(body);
    if (!completion.success) {
      throw new Error("OpenRouter returned an invalid chat completion");
    }
    return completion.data;
  }
}
