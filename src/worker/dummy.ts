import { setTimeout as delay } from "node:timers/promises";
import type { SessionWorker, WorkerContext, WorkerEvent } from "./types";

export type DummyWorkerOptions = {
  stepDelayMs?: number;
};

export class DummyWorker implements SessionWorker {
  private readonly stepDelayMs: number;

  constructor({ stepDelayMs = 750 }: DummyWorkerOptions = {}) {
    this.stepDelayMs = stepDelayMs;
  }

  async run(context: WorkerContext): Promise<void> {
    for (const event of this.script(context)) {
      await delay(this.stepDelayMs, undefined, { signal: context.signal });
      context.emit(event);
    }
  }

  private script({ modelName, taskPrompt }: WorkerContext): WorkerEvent[] {
    return [
      {
        kind: "model_output",
        data: `I'll inspect the repository before working on: ${taskPrompt}`,
      },
      {
        kind: "tool",
        data: 'search_files {"query":"relevant implementation","path":"src"}',
      },
      {
        kind: "model_output",
        data: "I found the relevant code. I'll make a focused change and keep the existing conventions.",
      },
      {
        kind: "tool",
        data: 'apply_patch {"files_changed":2}',
      },
      {
        kind: "model_output",
        data: "The change is in place. I'll run the checks now.",
      },
      {
        kind: "tool",
        data: 'run_command {"command":"npm test"}',
      },
      {
        kind: "tool",
        data: "run_command completed with exit code 0",
      },
      {
        kind: "usage",
        data: "1,248 input tokens · 286 output tokens · $0.0042",
      },
      {
        kind: "model_output",
        data: `${modelName} finished the requested change and all checks pass.`,
      },
    ];
  }
}
