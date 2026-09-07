import type { ModelEffort } from "../models";
import type { CommandResult } from "../sandbox/types";
import type { TokenUsage } from "../usage";

export type WorkerEvent =
  | { kind: "log" | "model_output" | "tool"; data: string }
  | { kind: "usage"; data: string; usage: TokenUsage };

export type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

export type WorkerContext = {
  modelId: string;
  modelName: string;
  effort: ModelEffort;
  messages: ConversationMessage[];
  signal: AbortSignal;
  emit: (event: WorkerEvent) => void;
  runCommand?: (command: string) => Promise<CommandResult>;
};

export interface TrajectoryWorker {
  run(context: WorkerContext): Promise<void>;
}
