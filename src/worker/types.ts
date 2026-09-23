import type { ModelEffort, ModelProvider } from "../models";
import type { CommandResult } from "../sandbox/types";
import type { TokenUsage } from "../usage";

export type WorkerEvent =
  | { kind: "log" | "model_output" | "tool"; data: string }
  | { kind: "usage"; data: string; usage: TokenUsage };

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

// The wire format the provider expects. It is persisted verbatim so that an
// interrupted turn can be replayed with its tool calls and results intact.
export type ConversationMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | { role: "assistant"; content: string | null; tool_calls: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type GarageSettings = {
  models: Array<{
    id: string;
    name: string;
    provider: string;
    effort: string;
  }>;
  repos: Array<{ owner: string; name: string; defaultBranch: string }>;
};

export type WorkerContext = {
  modelId: string;
  modelName: string;
  provider: ModelProvider;
  effort: ModelEffort;
  messages: ConversationMessage[];
  signal: AbortSignal;
  emit: (event: WorkerEvent) => void;
  appendMessage: (message: ConversationMessage) => void;
  runCommand?: (command: string) => Promise<CommandResult>;
  setTrajectoryName?: (name: string) => Promise<void>;
  garageSettings?: () => Promise<GarageSettings>;
};

export interface TrajectoryWorker {
  run(context: WorkerContext): Promise<void>;
}
