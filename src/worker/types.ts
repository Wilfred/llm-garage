import type { ModelId } from "../models";
import type { CommandResult } from "../sandbox/types";

export type WorkerEvent = {
  kind: "log" | "model_output" | "tool" | "usage";
  data: string;
};

export type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

export type WorkerContext = {
  modelId: ModelId;
  modelName: string;
  messages: ConversationMessage[];
  signal: AbortSignal;
  emit: (event: WorkerEvent) => void;
  runCommand?: (command: string) => Promise<CommandResult>;
};

export interface TrajectoryWorker {
  run(context: WorkerContext): Promise<void>;
}
