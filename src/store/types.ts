export type Repo = {
  id: string;
  owner: string;
  name: string;
  defaultBranch: string;
  createdAt: Date;
};

export type PromptScope = "global" | "repo";

export type SystemPrompt = {
  id: string;
  name: string;
  scope: PromptScope;
  repoId?: string;
  createdAt: Date;
};

export type PromptVersion = {
  id: string;
  promptId: string;
  content: string;
  note?: string;
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

export type RunnerName = "echo" | "codex";

export type Session = {
  id: string;
  parentId?: string;
  rootId: string;
  repoId: string;
  title: string;
  status: SessionStatus;
  runner: RunnerName;
  taskPrompt: string;
  systemPromptExtra: string;
  composedSystemPrompt: string;
  createPr: boolean;
  autoMerge: boolean;
  prUrl?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type TurnKind = "initial" | "feedback" | "spawn";
export type TurnStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type Turn = {
  id: string;
  sessionId: string;
  kind: TurnKind;
  prompt: string;
  composedSystemPrompt: string;
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

export type CreatePromptInput = {
  name: string;
  scope: PromptScope;
  repoId?: string;
  content: string;
  note?: string;
};

export type CreateSessionInput = {
  repoId: string;
  parentId?: string;
  title: string;
  runner: RunnerName;
  taskPrompt: string;
  systemPromptExtra: string;
  createPr: boolean;
  autoMerge: boolean;
};

export type DeleteRepoResult = "deleted" | "in_use" | "not_found";

export interface DataStore {
  listRepos(): Promise<Repo[]>;
  getRepo(id: string): Promise<Repo | undefined>;
  createRepo(input: CreateRepoInput): Promise<Repo>;
  deleteRepo(id: string): Promise<DeleteRepoResult>;

  listPrompts(): Promise<SystemPrompt[]>;
  getPrompt(id: string): Promise<SystemPrompt | undefined>;
  createPrompt(input: CreatePromptInput): Promise<SystemPrompt>;
  listPromptVersions(promptId: string): Promise<PromptVersion[]>;
  addPromptVersion(
    promptId: string,
    content: string,
    note?: string,
  ): Promise<PromptVersion>;
  getBasePromptId(): Promise<string | undefined>;
  setBasePrompt(promptId: string | undefined): Promise<void>;
  composeSystemPrompt(repoId: string, extra: string): Promise<string>;

  listSessions(): Promise<Session[]>;
  getSession(id: string): Promise<Session | undefined>;
  createSession(input: CreateSessionInput): Promise<Session>;
  listTurns(sessionId: string): Promise<Turn[]>;
  listRunEvents(turnId: string): Promise<RunEvent[]>;
  addFeedback(sessionId: string, feedback: string): Promise<Turn>;
  cancelSession(sessionId: string): Promise<boolean>;
  archiveSession(sessionId: string): Promise<boolean>;
}
