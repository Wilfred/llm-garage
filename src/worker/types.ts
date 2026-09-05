export type WorkerEvent = {
  kind: "log" | "model_output" | "tool" | "usage";
  data: string;
};

export type WorkerContext = {
  modelName: string;
  taskPrompt: string;
  signal: AbortSignal;
  emit: (event: WorkerEvent) => void;
};

export interface SessionWorker {
  run(context: WorkerContext): Promise<void>;
}
