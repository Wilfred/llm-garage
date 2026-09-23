import { z } from "zod";
import type { GarageSettings, ToolCall, WorkerContext } from "./types";
import type { WebToolProvider } from "./web-tools";

export const codingAgentPrompt = `You are a coding agent working in an isolated Docker container for one LLM Garage trajectory. The requested repository is cloned at /home/agent/repo, which is your working directory, and your writable home is /home/agent. The container has outbound network access and common development tools including Git, GitHub CLI, curl, jq, ripgrep, Python, Node.js, npm, and native build tools. When GITHUB_TOKEN is available, Git and GitHub CLI are configured to use it.

Use the environment to complete the requested software task. Typical goals include examining a codebase, investigating or fixing a bug, implementing a feature, running appropriate validation, and creating or updating a pull request. Read repository-local instructions such as AGENTS.md before changing code, and follow the user's requested scope and delivery split.

Set a concise, specific trajectory name with set_trajectory_name near the start of the session, as soon as you understand the task.`;

const commandArgumentsSchema = z.object({
  command: z.string().min(1).max(4096),
});

const setTrajectoryNameArgumentsSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

const fetchUrlArgumentsSchema = z.object({
  url: z.url().max(2048),
});

const garageSettingsArgumentsSchema = z.object({});

const searchWebArgumentsSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .max(400)
    .refine((query) => query.split(/\s+/u).length <= 50),
  count: z.number().int().min(1).max(10).optional().default(5),
});

export const agentTools = [
  {
    type: "function",
    function: {
      name: "set_trajectory_name",
      description:
        "Set a concise, specific name that identifies this trajectory in LLM Garage.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            minLength: 1,
            maxLength: 80,
            description: "The trajectory name.",
          },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "garage_settings",
      description:
        "See the models and repositories configured in this LLM Garage instance.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description:
        "Run a shell command in the trajectory's isolated Docker container. A command that runs past the time limit is stopped, and its result reports timedOut.",
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

export async function runAgentTool(
  toolCall: ToolCall,
  context: WorkerContext,
  webTools: WebToolProvider | undefined,
): Promise<string> {
  let rawArguments: unknown;
  try {
    rawArguments = JSON.parse(toolCall.function.arguments);
  } catch {
    return JSON.stringify({ error: "Tool arguments are not valid JSON" });
  }
  switch (toolCall.function.name) {
    case "set_trajectory_name": {
      const parsed = setTrajectoryNameArgumentsSchema.safeParse(rawArguments);
      if (!parsed.success) {
        return JSON.stringify({
          error: "Invalid set_trajectory_name arguments",
        });
      }
      const setTrajectoryName = context.setTrajectoryName;
      if (!setTrajectoryName) {
        return JSON.stringify({
          error: "Trajectory naming is not configured",
        });
      }
      return executeTool(
        "set_trajectory_name",
        parsed.data,
        context,
        async () => {
          await setTrajectoryName(parsed.data.name);
          return { name: parsed.data.name };
        },
      );
    }
    case "garage_settings": {
      const parsed = garageSettingsArgumentsSchema.safeParse(rawArguments);
      if (!parsed.success) {
        return JSON.stringify({
          error: "Invalid garage_settings arguments",
        });
      }
      const garageSettings = context.garageSettings;
      if (!garageSettings) {
        return JSON.stringify({
          error: "Garage settings are not configured",
        });
      }
      return executeTool(
        "garage_settings",
        parsed.data,
        context,
        async (): Promise<GarageSettings> => garageSettings(),
      );
    }
    case "run_command": {
      const parsed = commandArgumentsSchema.safeParse(rawArguments);
      if (!parsed.success) {
        return JSON.stringify({ error: "Invalid run_command arguments" });
      }
      const runCommand = context.runCommand;
      if (!runCommand) {
        return JSON.stringify({ error: "Docker sandbox is not configured" });
      }
      return executeTool("run_command", parsed.data, context, () =>
        runCommand(parsed.data.command),
      );
    }
    case "fetch_url": {
      const parsed = fetchUrlArgumentsSchema.safeParse(rawArguments);
      if (!parsed.success) {
        return JSON.stringify({ error: "Invalid fetch_url arguments" });
      }
      if (!webTools) {
        return JSON.stringify({ error: "Web tools are not configured" });
      }
      return executeTool("fetch_url", parsed.data, context, () =>
        webTools.fetchUrl(parsed.data.url, context.signal),
      );
    }
    case "search_web": {
      const parsed = searchWebArgumentsSchema.safeParse(rawArguments);
      if (!parsed.success) {
        return JSON.stringify({ error: "Invalid search_web arguments" });
      }
      if (!webTools) {
        return JSON.stringify({ error: "Web tools are not configured" });
      }
      return executeTool("search_web", parsed.data, context, () =>
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

async function executeTool(
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
