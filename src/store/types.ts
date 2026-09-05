import type { ModelId } from "../models";

export type Repo = {
  id: string;
  owner: string;
  name: string;
  defaultBranch: string;
  createdAt: Date;
};

export type SessionStatus =
  | "queued"
  | "running"
  | "awaiting_feedback"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "archived";

export type Session = {
  id: string;
  parentId?: string;
  rootId: string;
  repoId: string;
  title: string;
  status: SessionStatus;
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
  sessionId: string;
  kind: TurnKind;
  prompt: string;
  status: TurnStatus;
  createdAt: Date;
  finishedAt?: Date;
};

export type RunEvent = {
  id: string;
  turnId: string;
  kind: "log" | "status" | "system";
  data: string;
  ts: Date;
};

export type CreateRepoInput = Pick<Repo, "owner" | "name" | "defaultBranch">;

export type CreateSessionInput = {
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

  listSessions(): Promise<Session[]>;
  getSession(id: string): Promise<Session | undefined>;
  createSession(input: CreateSessionInput): Promise<Session>;
  listTurns(sessionId: string): Promise<Turn[]>;
  listRunEvents(turnId: string): Promise<RunEvent[]>;
  addFeedback(sessionId: string, feedback: string): Promise<Turn>;
  cancelSession(sessionId: string): Promise<boolean>;
  archiveSession(sessionId: string): Promise<boolean>;
}
