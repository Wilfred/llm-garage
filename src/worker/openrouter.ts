import { z } from "zod";
import type { TrajectoryWorker, WorkerContext } from "./types";

const defaultEndpoint = "https://openrouter.ai/api/v1/chat/completions";

const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable() }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative(),
      completion_tokens: z.number().int().nonnegative(),
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
};

export class OpenRouterWorker implements TrajectoryWorker {
  private readonly apiKey: string | undefined;
  private readonly endpoint: string;
  private readonly fetch: typeof fetch;

  constructor({
    apiKey,
    endpoint = defaultEndpoint,
    fetch: fetchImplementation = fetch,
  }: OpenRouterWorkerOptions) {
    this.apiKey = apiKey;
    this.endpoint = endpoint;
    this.fetch = fetchImplementation;
  }

  async run(context: WorkerContext): Promise<void> {
    if (!this.apiKey) {
      throw new Error("OPENROUTER_API_KEY is not configured");
    }

    const response = await this.fetch(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/Wilfred/llm-garage",
        "X-OpenRouter-Title": "LLM Garage",
      },
      body: JSON.stringify({
        model: context.modelId,
        messages: context.messages,
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

    const content = completion.data.choices[0]?.message.content;
    if (!content?.trim()) {
      throw new Error("OpenRouter returned an empty chat completion");
    }

    context.emit({ kind: "model_output", data: content });
    if (completion.data.usage) {
      context.emit({
        kind: "usage",
        data: `${completion.data.usage.prompt_tokens.toLocaleString("en-US")} input tokens · ${completion.data.usage.completion_tokens.toLocaleString("en-US")} output tokens`,
      });
    }
  }
}
