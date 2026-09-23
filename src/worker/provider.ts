import type { ModelProvider } from "../models";
import type { TrajectoryWorker, WorkerContext } from "./types";

// Sends each trajectory to the worker for its model's provider.
export class ProviderWorker implements TrajectoryWorker {
  constructor(
    private readonly workers: Record<ModelProvider, TrajectoryWorker>,
  ) {}

  run(context: WorkerContext): Promise<void> {
    return this.workers[context.provider].run(context);
  }
}
