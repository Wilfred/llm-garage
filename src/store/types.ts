import type { ModelId } from "../models";

export type Repo = {
  id: string;
  owner: string;
  name: string;
  defaultBranch: string;
  createdAt: Date;
};

export type TrajectoryStatus =
  | "queued"
  | "running"
  | "awaiting_feedback"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "archived";

export type Trajectory = {
  id: string;
  parentId?: string;
  rootId: string;
  repoId: string;
  title: string;
  status: TrajectoryStatus;
  modelId: ModelId;
  taskPrompt: string;
  createPr: boolean;
  autoMerge: boolean;
  prUrl?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type TurnKind = "initial" | "feedback" | "spawn";
export type TurnStatus =
  "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type Turn = {
  id: string;
  trajectoryId: string;
  kind: TurnKind;
  prompt: string;
  status: TurnStatus;
  createdAt: Date;
  finishedAt?: Date;
};

export type RunEvent = {
  id: string;
  trajectoryId: string;
  turnId: string;
  sequence: number;
  kind: "log" | "model_output" | "status" | "system" | "tool" | "usage";
  data: string;
  ts: Date;
};

export type CreateRepoInput = Pick<Repo, "owner" | "name" | "defaultBranch">;

export type CreateTrajectoryInput = {
  repoId: string;
  parentId?: string;
  title: string;
  modelId: ModelId;
  taskPrompt: string;
  createPr: boolean;
  autoMerge: boolean;
};

export type DeleteRepoResult = "deleted" | "in_use" | "not_found";

export interface DataStore {
  listRepos(): Promise<Repo[]>;
  getRepo(id: string): Promise<Repo | undefined>;
  createRepo(input: CreateRepoInput): Promise<Repo>;
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
