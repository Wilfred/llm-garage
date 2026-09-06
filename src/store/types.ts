import type { ModelId } from "../models";

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
  repoId: string;
  title: string;
  status: TrajectoryStatus;
  modelId: ModelId;
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

export type CreateRepoInput = Pick<
  Repo,
  "owner" | "name" | "defaultBranch" | "autoMerge"
>;

export type CreateTrajectoryInput = {
  repoId: string;
  parentId?: string;
  title: string;
  modelId: ModelId;
  taskPrompt: string;
};

export type DeleteRepoResult = "deleted" | "in_use" | "not_found";

export interface DataStore {
  listRepos(): Promise<Repo[]>;
  getRepo(id: string): Promise<Repo | undefined>;
  createRepo(input: CreateRepoInput): Promise<Repo>;
  setRepoAutoMerge(id: string, autoMerge: boolean): Promise<boolean>;
  deleteRepo(id: string): Promise<DeleteRepoResult>;

  listTrajectories(): Promise<Trajectory[]>;
  getTrajectory(id: string): Promise<Trajectory | undefined>;
  createTrajectory(input: CreateTrajectoryInput): Promise<Trajectory>;
  listTurns(trajectoryId: string): Promise<Turn[]>;
  listRunEvents(turnId: string): Promise<RunEvent[]>;
  addFeedback(trajectoryId: string, feedback: string): Promise<Turn>;
  cancelTrajectory(trajectoryId: string): Promise<boolean>;
  archiveTrajectory(trajectoryId: string): Promise<boolean>;
}
