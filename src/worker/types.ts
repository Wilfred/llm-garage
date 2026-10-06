import type { ModelEffort } from "../models";
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
  models: Array<{ id: string; name: string; effort: string }>;
  repos: Array<{ owner: string; name: string; defaultBranch: string }>;
};

export type TrajectorySummary = {
  id: string;
  title: string;
  status: string;
  model: string;
  repo: string;
  parentId?: string;
  comparisonId?: string;
  prUrl?: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkerContext = {
  modelId: string;
  modelName: string;
  effort: ModelEffort;
  messages: ConversationMessage[];
  signal: AbortSignal;
  emit: (event: WorkerEvent) => void;
  appendMessage: (message: ConversationMessage) => void;
  runCommand?: (command: string) => Promise<CommandResult>;
  setTrajectoryName?: (name: string) => Promise<void>;
  garageSettings?: () => Promise<GarageSettings>;
  listTrajectories?: () => Promise<TrajectorySummary[]>;
  trajectoryTranscript?: (id: string) => Promise<string | undefined>;
};

export interface TrajectoryWorker {
  run(context: WorkerContext): Promise<void>;
}
