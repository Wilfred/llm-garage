import { z } from "zod";
import type { TrajectoryWorker, WorkerContext } from "./types";
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
    })
    .optional(),
});

const errorSchema = z.object({
  error: z.object({ message: z.string() }),
});

const commandArgumentsSchema = z.object({
  command: z.string().min(1).max(4096),
});

const fetchUrlArgumentsSchema = z.object({
  url: z.url().max(2048),
});

const searchWebArgumentsSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .max(400)
    .refine((query) => query.split(/\s+/u).length <= 50),
  count: z.number().int().min(1).max(10).optional().default(5),
});

const tools = [
  {
    type: "function",
    function: {
      name: "run_command",
      description:
        "Run a shell command in the trajectory's isolated Docker container.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The command to run with /bin/sh -lc.",
          },
        },
        required: ["command"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_url",
      description:
        "Fetch bounded textual content from a public HTTP or HTTPS URL.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The public HTTP or HTTPS URL to fetch.",
          },
        },
        required: ["url"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_web",
      description: "Search the public web using Brave Search.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query.",
          },
          count: {
            type: "integer",
            minimum: 1,
            maximum: 10,
            description: "Number of results to return. Defaults to 5.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
] as const;

type ProviderMessage =
  | { role: "user" | "assistant"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    }
  | { role: "tool"; tool_call_id: string; content: string };

export type OpenRouterWorkerOptions = {
  apiKey: string | undefined;
  endpoint?: string;
  fetch?: typeof fetch;
  maxSteps?: number;
  webTools?: WebToolProvider;
};

export class OpenRouterWorker implements TrajectoryWorker {
  private readonly apiKey: string | undefined;
  private readonly endpoint: string;
  private readonly fetch: typeof fetch;
  private readonly maxSteps: number;
  private readonly webTools: WebToolProvider | undefined;

  constructor({
    apiKey,
    endpoint = defaultEndpoint,
    fetch: fetchImplementation = fetch,
    maxSteps = 12,
    webTools,
  }: OpenRouterWorkerOptions) {
    this.apiKey = apiKey;
    this.endpoint = endpoint;
    this.fetch = fetchImplementation;
    this.maxSteps = maxSteps;
    this.webTools = webTools;
  }

  async run(context: WorkerContext): Promise<void> {
    if (!this.apiKey) {
      throw new Error("OPENROUTER_API_KEY is not configured");
    }

    const messages: ProviderMessage[] = context.messages.map((message) => ({
      ...message,
    }));
    for (let step = 0; step < this.maxSteps; step += 1) {
      const completion = await this.complete(messages, context);
      const message = completion.choices[0]?.message;
      if (!message) throw new Error("OpenRouter returned an empty completion");

      if (message.content?.trim()) {
        context.emit({ kind: "model_output", data: message.content });
      }
      if (completion.usage) {
        context.emit({
          kind: "usage",
          data: `${completion.usage.prompt_tokens.toLocaleString("en-US")} input tokens · ${completion.usage.completion_tokens.toLocaleString("en-US")} output tokens`,
        });
      }
      if (!message.tool_calls?.length) {
        if (!message.content?.trim()) {
          throw new Error("OpenRouter returned an empty chat completion");
        }
        return;
      }

      messages.push({
        role: "assistant",
        content: message.content,
        tool_calls: message.tool_calls,
      });
      for (const toolCall of message.tool_calls) {
        const result = await this.runTool(toolCall, context);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        });
      }
    }

    throw new Error(
      `OpenRouter worker exceeded its ${this.maxSteps.toString()}-step limit`,
    );
  }

  private async complete(
    messages: ProviderMessage[],
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
      body: JSON.stringify({ model: context.modelId, messages, tools }),
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

  private async runTool(
    toolCall: {
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    },
    context: WorkerContext,
  ): Promise<string> {
    let rawArguments: unknown;
    try {
      rawArguments = JSON.parse(toolCall.function.arguments);
    } catch {
      return JSON.stringify({ error: "Tool arguments are not valid JSON" });
    }
    switch (toolCall.function.name) {
      case "run_command": {
        const parsed = commandArgumentsSchema.safeParse(rawArguments);
        if (!parsed.success) {
          return JSON.stringify({ error: "Invalid run_command arguments" });
        }
        const runCommand = context.runCommand;
        if (!runCommand) {
          return JSON.stringify({ error: "Docker sandbox is not configured" });
        }
        return this.executeTool("run_command", parsed.data, context, () =>
          runCommand(parsed.data.command),
        );
      }
      case "fetch_url": {
        const parsed = fetchUrlArgumentsSchema.safeParse(rawArguments);
        if (!parsed.success) {
          return JSON.stringify({ error: "Invalid fetch_url arguments" });
        }
        const webTools = this.webTools;
        if (!webTools) {
          return JSON.stringify({ error: "Web tools are not configured" });
        }
        return this.executeTool("fetch_url", parsed.data, context, () =>
          webTools.fetchUrl(parsed.data.url, context.signal),
        );
      }
      case "search_web": {
        const parsed = searchWebArgumentsSchema.safeParse(rawArguments);
        if (!parsed.success) {
          return JSON.stringify({ error: "Invalid search_web arguments" });
        }
        const webTools = this.webTools;
        if (!webTools) {
          return JSON.stringify({ error: "Web tools are not configured" });
        }
        return this.executeTool("search_web", parsed.data, context, () =>
          webTools.searchWeb(
            parsed.data.query,
            parsed.data.count,
            context.signal,
          ),
        );
      }
      default:
        return JSON.stringify({ error: "Unknown tool" });
    }
  }

  private async executeTool(
    name: string,
    arguments_: object,
    context: WorkerContext,
    action: () => Promise<unknown>,
  ): Promise<string> {
    context.emit({
      kind: "tool",
      data: `${name} ${JSON.stringify(arguments_)}`,
    });
    try {
      const result = await action();
      const serialized = JSON.stringify(result);
      context.emit({ kind: "tool", data: `${name} result ${serialized}` });
      return serialized;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const serialized = JSON.stringify({ error: message });
      context.emit({ kind: "tool", data: `${name} result ${serialized}` });
      return serialized;
    }
  }
}
