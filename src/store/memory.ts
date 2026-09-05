import type {
  CreateRepoInput,
  CreateSessionInput,
  DataStore,
  DeleteRepoResult,
  Repo,
  RunEvent,
  Session,
  Turn,
} from "./types";
import { getModel } from "../models";
import { DummyWorker } from "../worker/dummy";
import type { SessionWorker } from "../worker/types";
import { RepoAlreadyExistsError } from "./errors";

export type MemoryStoreOptions = {
  seed?: boolean;
  simulationStepMs?: number;
  worker?: SessionWorker;
};

const minutesAgo = (minutes: number): Date =>
  new Date(Date.now() - minutes * 60_000);

export class MemoryDataStore implements DataStore {
  private readonly repos = new Map<string, Repo>();
  private readonly sessions = new Map<string, Session>();
  private readonly turns = new Map<string, Turn>();
  private readonly events = new Map<string, RunEvent>();
  private readonly activeWorkers = new Map<string, AbortController>();
  private readonly worker: SessionWorker;
  private sequence = 100;
  private lastTimestamp = 0;

  constructor({
    seed = true,
    simulationStepMs = 500,
    worker = new DummyWorker({ stepDelayMs: simulationStepMs }),
  }: MemoryStoreOptions = {}) {
    this.worker = worker;
    if (seed) this.seed();
  }

  async listRepos(): Promise<Repo[]> {
    return this.byNewest(this.repos.values());
  }

  async getRepo(id: string): Promise<Repo | undefined> {
    return this.repos.get(id);
  }

  async createRepo(input: CreateRepoInput): Promise<Repo> {
    if (
      [...this.repos.values()].some(
        (repo) => repo.owner === input.owner && repo.name === input.name,
      )
    ) {
      throw new RepoAlreadyExistsError(input.owner, input.name);
    }
    const repo: Repo = { id: this.id("repo"), ...input, createdAt: this.now() };
    this.repos.set(repo.id, repo);
    return repo;
  }

  async deleteRepo(id: string): Promise<DeleteRepoResult> {
    if (!this.repos.has(id)) return "not_found";
    if (this.repoIsInUse(id)) return "in_use";
    this.repos.delete(id);
    return "deleted";
  }

  async listSessions(): Promise<Session[]> {
    return [...this.sessions.values()].sort(
      (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
    );
  }

  async getSession(id: string): Promise<Session | undefined> {
    return this.sessions.get(id);
  }

  async createSession(input: CreateSessionInput): Promise<Session> {
    if (!(await this.getRepo(input.repoId)))
      throw new Error("Repository not found");
    const parent = input.parentId
      ? this.sessions.get(input.parentId)
      : undefined;
    if (input.parentId && !parent) throw new Error("Parent session not found");
    const now = this.now();
    const id = this.id("session");
    const session: Session = {
      id,
      ...(parent ? { parentId: parent.id } : {}),
      rootId: parent?.rootId ?? id,
      repoId: input.repoId,
      title: input.title,
      status: "running",
      modelId: input.modelId,
      taskPrompt: input.taskPrompt,
      createPr: input.createPr,
      autoMerge: input.autoMerge,
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(session.id, session);

    const turn: Turn = {
      id: this.id("turn"),
      sessionId: session.id,
      kind: parent ? "spawn" : "initial",
      prompt: input.taskPrompt,
      status: "running",
      createdAt: now,
    };
    this.turns.set(turn.id, turn);
    this.startWorker(session.id, turn.id);
    return session;
  }

  async listTurns(sessionId: string): Promise<Turn[]> {
    return [...this.turns.values()]
      .filter((turn) => turn.sessionId === sessionId)
      .sort(
        (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
      );
  }

  async listRunEvents(turnId: string): Promise<RunEvent[]> {
    return [...this.events.values()]
      .filter((event) => event.turnId === turnId)
      .sort((left, right) => left.sequence - right.sequence);
  }

  async addFeedback(sessionId: string, feedback: string): Promise<Turn> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Session not found");
    if (session.status === "archived" || session.status === "running") {
      throw new Error("This session cannot accept feedback right now");
    }
    const now = this.now();
    const turn: Turn = {
      id: this.id("turn"),
      sessionId,
      kind: "feedback",
      prompt: feedback,
      status: "running",
      createdAt: now,
    };
    this.turns.set(turn.id, turn);
    session.status = "running";
    session.updatedAt = now;
    this.startWorker(session.id, turn.id);
    return turn;
  }

  async cancelSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (
      !session ||
      (session.status !== "running" && session.status !== "queued")
    )
      return false;
    this.stopWorker(session.id);
    session.status = "cancelled";
    session.updatedAt = this.now();
    const turn = this.activeTurn(session.id);
    if (turn) {
      turn.status = "cancelled";
      turn.finishedAt = this.now();
      this.addEvent(turn.id, "status", "Session cancelled by user");
    }
    return true;
  }

  async archiveSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session || session.status === "archived") return false;
    this.stopWorker(session.id);
    const turn = this.activeTurn(session.id);
    if (turn) {
      turn.status = "cancelled";
      turn.finishedAt = this.now();
      this.addEvent(
        turn.id,
        "status",
        "Turn stopped because the session was archived",
      );
    }
    session.status = "archived";
    session.updatedAt = this.now();
    return true;
  }

  private startWorker(sessionId: string, turnId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const model = getModel(session.modelId);
    const controller = new AbortController();
    this.activeWorkers.set(sessionId, controller);
    this.addEvent(turnId, "status", `${model.name} dummy worker started`);
    void this.worker
      .run({
        modelName: model.name,
        taskPrompt: session.taskPrompt,
        signal: controller.signal,
        emit: ({ kind, data }) => {
          const currentSession = this.sessions.get(sessionId);
          const turn = this.turns.get(turnId);
          if (
            currentSession?.status === "running" &&
            turn?.status === "running"
          ) {
            this.addEvent(turnId, kind, data);
            currentSession.updatedAt = this.now();
          }
        },
      })
      .then(() => {
        const session = this.sessions.get(sessionId);
        const turn = this.turns.get(turnId);
        if (session?.status === "running" && turn?.status === "running") {
          turn.status = "succeeded";
          turn.finishedAt = this.now();
          session.status = "succeeded";
          session.updatedAt = this.now();
          this.addEvent(turnId, "status", "Session finished");
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const session = this.sessions.get(sessionId);
        const turn = this.turns.get(turnId);
        if (session?.status === "running" && turn?.status === "running") {
          turn.status = "failed";
          turn.finishedAt = this.now();
          session.status = "failed";
          session.updatedAt = this.now();
          const message =
            error instanceof Error ? error.message : String(error);
          this.addEvent(turnId, "system", `Worker failed: ${message}`);
          this.addEvent(turnId, "status", "Session failed");
        }
      })
      .finally(() => {
        if (this.activeWorkers.get(sessionId) === controller) {
          this.activeWorkers.delete(sessionId);
        }
      });
  }

  private stopWorker(sessionId: string): void {
    this.activeWorkers.get(sessionId)?.abort();
    this.activeWorkers.delete(sessionId);
  }

  private activeTurn(sessionId: string): Turn | undefined {
    return [...this.turns.values()].find(
      (turn) =>
        turn.sessionId === sessionId &&
        (turn.status === "running" || turn.status === "queued"),
    );
  }

  private addEvent(
    turnId: string,
    kind: RunEvent["kind"],
    data: string,
    ts?: Date,
  ): void {
    const turn = this.turns.get(turnId);
    if (!turn) throw new Error("Turn not found");
    const sequence =
      Math.max(
        0,
        ...[...this.events.values()]
          .filter((event) => event.sessionId === turn.sessionId)
          .map((event) => event.sequence),
      ) + 1;
    const event: RunEvent = {
      id: this.id("event"),
      sessionId: turn.sessionId,
      turnId,
      sequence,
      kind,
      data,
      ts: ts ?? this.now(),
    };
    this.events.set(event.id, event);
  }

  private byNewest<T extends { createdAt: Date }>(items: Iterable<T>): T[] {
    return [...items].sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
    );
  }

  private id(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence.toString(36)}`;
  }

  private now(): Date {
    this.lastTimestamp = Math.max(Date.now(), this.lastTimestamp + 1);
    return new Date(this.lastTimestamp);
  }

  protected repoIsInUse(id: string): boolean {
    return [...this.sessions.values()].some((session) => session.repoId === id);
  }

  private seed(): void {
    const repos: Repo[] = [
      {
        id: "repo-garage",
        owner: "Wilfred",
        name: "llm-garage",
        defaultBranch: "main",
        createdAt: minutesAgo(9_000),
      },
      {
        id: "repo-parser",
        owner: "Wilfred",
        name: "tree-sitter-elisp",
        defaultBranch: "master",
        createdAt: minutesAgo(8_000),
      },
      {
        id: "repo-notes",
        owner: "Wilfred",
        name: "digital-garden",
        defaultBranch: "main",
        createdAt: minutesAgo(7_000),
      },
    ];
    for (const repo of repos) this.repos.set(repo.id, repo);

    const sessions: Session[] = [
      this.fixtureSession(
        "session-m3",
        "Prototype the session UI",
        "repo-garage",
        "running",
        32,
      ),
      this.fixtureSession(
        "session-navigation",
        "Tighten dashboard navigation",
        "repo-garage",
        "awaiting_feedback",
        24,
        "session-m3",
      ),
      this.fixtureSession(
        "session-tests",
        "Add rendering safety tests",
        "repo-garage",
        "succeeded",
        18,
        "session-m3",
      ),
      this.fixtureSession(
        "session-parser",
        "Investigate bytecode parse failure",
        "repo-parser",
        "failed",
        140,
      ),
      this.fixtureSession(
        "session-docs",
        "Refresh project notes",
        "repo-notes",
        "archived",
        1_400,
      ),
      this.fixtureSession(
        "session-queued",
        "Audit mobile spacing",
        "repo-garage",
        "queued",
        8,
        "session-m3",
      ),
    ];
    for (const session of sessions) this.sessions.set(session.id, session);

    for (const session of sessions) {
      const status =
        session.status === "running" || session.status === "queued"
          ? session.status
          : session.status === "failed"
            ? "failed"
            : "succeeded";
      const turn: Turn = {
        id: `turn-${session.id}`,
        sessionId: session.id,
        kind: session.parentId ? "spawn" : "initial",
        prompt: session.taskPrompt,
        status,
        createdAt: session.createdAt,
        ...(status === "running" || status === "queued"
          ? {}
          : { finishedAt: session.updatedAt }),
      };
      this.turns.set(turn.id, turn);
      this.addEvent(
        turn.id,
        "status",
        status === "running"
          ? `${getModel(session.modelId).name} is working via OpenRouter`
          : `Session ${status}`,
        session.createdAt,
      );
      this.addEvent(
        turn.id,
        "log",
        `Loaded ${session.repoId} on a prototype workspace`,
        minutesAgo(Math.max(1, 30)),
      );
      this.addEvent(
        turn.id,
        "log",
        session.status === "failed"
          ? "Command exited with status 1 (fixture)"
          : "Reviewed the requested files (fixture)",
        session.updatedAt,
      );
    }
  }

  private fixtureSession(
    id: string,
    title: string,
    repoId: string,
    status: Session["status"],
    minutes: number,
    parentId?: string,
  ): Session {
    return {
      id,
      ...(parentId === undefined ? {} : { parentId }),
      rootId: parentId ? "session-m3" : id,
      repoId,
      title,
      status,
      modelId:
        id === "session-docs"
          ? "z-ai/glm-5.2"
          : id === "session-parser"
            ? "moonshotai/kimi-k3"
            : id === "session-tests"
              ? "anthropic/claude-opus-5"
              : "openai/gpt-5.6-sol",
      taskPrompt: title,
      createPr: id !== "session-parser",
      autoMerge: id === "session-tests",
      createdAt: minutesAgo(minutes + 15),
      updatedAt: minutesAgo(minutes),
    };
  }
}
