import type { ModelEffort } from "../models";
import type { TokenUsage } from "../usage";

export type Model = {
  // The OpenRouter model slug, such as "anthropic/claude-opus-5".
  id: string;
  name: string;
  provider: string;
  effort: ModelEffort;
  createdAt: Date;
};

export type Repo = {
  id: string;
  owner: string;
  name: string;
  defaultBranch: string;
  autoMerge: boolean;
  createdAt: Date;
};

export const trajectoryStatuses = [
  "queued",
  "running",
  "awaiting_feedback",
  "succeeded",
  "failed",
  "cancelled",
  "archived",
] as const;
export type TrajectoryStatus = (typeof trajectoryStatuses)[number];

export type Trajectory = {
  id: string;
  parentId?: string;
  rootId: string;
  comparisonId?: string;
  repoId: string;
  title: string;
  status: TrajectoryStatus;
  modelId: string;
  taskPrompt: string;
  prUrl?: string;
  createdAt: Date;
  updatedAt: Date;
};

export const turnKinds = ["initial", "feedback", "spawn"] as const;
export type TurnKind = (typeof turnKinds)[number];
export const turnStatuses = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type TurnStatus = (typeof turnStatuses)[number];

export type Turn = {
  id: string;
  trajectoryId: string;
  kind: TurnKind;
  prompt: string;
  status: TurnStatus;
  usage?: TokenUsage;
  createdAt: Date;
  finishedAt?: Date;
};

export const runEventKinds = [
  "log",
  "status",
  "system",
  "model_output",
  "tool",
  "usage",
] as const;
export type RunEventKind = (typeof runEventKinds)[number];

export type RunEvent = {
  id: string;
  trajectoryId: string;
  turnId: string;
  sequence: number;
  kind: RunEventKind;
  data: string;
  ts: Date;
};

export type CreateModelInput = Pick<
  Model,
  "id" | "name" | "provider" | "effort"
>;

export type UpdateModelInput = Pick<Model, "name" | "provider" | "effort">;

export type DeleteModelResult = "deleted" | "in_use" | "not_found";

export type CreateRepoInput = Pick<
  Repo,
  "owner" | "name" | "defaultBranch" | "autoMerge"
>;

export type CreateTrajectoriesInput = {
  repoId: string;
  parentId?: string;
  title: string;
  modelIds: string[];
  taskPrompt: string;
};

export type DeleteRepoResult = "deleted" | "in_use" | "not_found";

export type SpendTotals = {
  trajectories: number;
  usage?: TokenUsage;
};

export type SpendGroup = SpendTotals & { id: string; label: string };

export type SpendReport = SpendTotals & {
  byModel: SpendGroup[];
  byRepo: SpendGroup[];
  // Turns that reported tokens without a cost, so the totals understate spend.
  unpricedTurns: number;
};

export interface DataStore {
  listModels(): Promise<Model[]>;
  getModel(id: string): Promise<Model | undefined>;
  createModel(input: CreateModelInput): Promise<Model>;
  updateModel(id: string, input: UpdateModelInput): Promise<Model | undefined>;
  deleteModel(id: string): Promise<DeleteModelResult>;

  listRepos(): Promise<Repo[]>;
  getRepo(id: string): Promise<Repo | undefined>;
  createRepo(input: CreateRepoInput): Promise<Repo>;
  setRepoAutoMerge(id: string, autoMerge: boolean): Promise<boolean>;
  deleteRepo(id: string): Promise<DeleteRepoResult>;

  listTrajectories(): Promise<Trajectory[]>;
  getSpend(): Promise<SpendReport>;
  getTrajectory(id: string): Promise<Trajectory | undefined>;
  createTrajectories(input: CreateTrajectoriesInput): Promise<Trajectory[]>;
  listComparison(comparisonId: string): Promise<Trajectory[]>;
  listTurns(trajectoryId: string): Promise<Turn[]>;
  listRunEvents(turnId: string): Promise<RunEvent[]>;
  addFeedback(trajectoryId: string, feedback: string): Promise<Turn>;
  cancelTrajectory(trajectoryId: string): Promise<boolean>;
  archiveTrajectory(trajectoryId: string): Promise<boolean>;
}
