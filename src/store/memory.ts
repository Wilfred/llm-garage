import type {
  CreateRepoInput,
  CreateTrajectoryInput,
  DataStore,
  DeleteRepoResult,
  Repo,
  RunEvent,
  Trajectory,
  Turn,
} from "./types";
import { getModel } from "../models";
import { DummyWorker } from "../worker/dummy";
import type { TrajectoryWorker } from "../worker/types";
import { RepoAlreadyExistsError } from "./errors";

export type MemoryStoreOptions = {
  seed?: boolean;
  simulationStepMs?: number;
  worker?: TrajectoryWorker;
};

const minutesAgo = (minutes: number): Date =>
  new Date(Date.now() - minutes * 60_000);

export class MemoryDataStore implements DataStore {
  private readonly repos = new Map<string, Repo>();
  private readonly trajectories = new Map<string, Trajectory>();
  private readonly turns = new Map<string, Turn>();
  private readonly events = new Map<string, RunEvent>();
  private readonly activeWorkers = new Map<string, AbortController>();
  private readonly worker: TrajectoryWorker;
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

  async listTrajectories(): Promise<Trajectory[]> {
    return [...this.trajectories.values()].sort(
      (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
    );
  }

  async getTrajectory(id: string): Promise<Trajectory | undefined> {
    return this.trajectories.get(id);
  }

  async createTrajectory(input: CreateTrajectoryInput): Promise<Trajectory> {
    if (!(await this.getRepo(input.repoId)))
      throw new Error("Repository not found");
    const parent = input.parentId
      ? this.trajectories.get(input.parentId)
      : undefined;
    if (input.parentId && !parent)
      throw new Error("Parent trajectory not found");
    const now = this.now();
    const id = this.id("trajectory");
    const trajectory: Trajectory = {
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
    this.trajectories.set(trajectory.id, trajectory);

    const turn: Turn = {
      id: this.id("turn"),
      trajectoryId: trajectory.id,
      kind: parent ? "spawn" : "initial",
      prompt: input.taskPrompt,
      status: "running",
      createdAt: now,
    };
    this.turns.set(turn.id, turn);
    this.startWorker(trajectory.id, turn.id);
    return trajectory;
  }

  async listTurns(trajectoryId: string): Promise<Turn[]> {
    return [...this.turns.values()]
      .filter((turn) => turn.trajectoryId === trajectoryId)
      .sort(
        (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
      );
  }

  async listRunEvents(turnId: string): Promise<RunEvent[]> {
    return [...this.events.values()]
      .filter((event) => event.turnId === turnId)
      .sort((left, right) => left.sequence - right.sequence);
  }

  async addFeedback(trajectoryId: string, feedback: string): Promise<Turn> {
    const trajectory = this.trajectories.get(trajectoryId);
    if (!trajectory) throw new Error("Trajectory not found");
    if (trajectory.status === "archived" || trajectory.status === "running") {
      throw new Error("This trajectory cannot accept feedback right now");
    }
    const now = this.now();
    const turn: Turn = {
      id: this.id("turn"),
      trajectoryId,
      kind: "feedback",
      prompt: feedback,
      status: "running",
      createdAt: now,
    };
    this.turns.set(turn.id, turn);
    trajectory.status = "running";
    trajectory.updatedAt = now;
    this.startWorker(trajectory.id, turn.id);
    return turn;
  }

  async cancelTrajectory(trajectoryId: string): Promise<boolean> {
    const trajectory = this.trajectories.get(trajectoryId);
    if (
      !trajectory ||
      (trajectory.status !== "running" && trajectory.status !== "queued")
    )
      return false;
    this.stopWorker(trajectory.id);
    trajectory.status = "cancelled";
    trajectory.updatedAt = this.now();
    const turn = this.activeTurn(trajectory.id);
    if (turn) {
      turn.status = "cancelled";
      turn.finishedAt = this.now();
      this.addEvent(turn.id, "status", "Trajectory cancelled by user");
    }
    return true;
  }

  async archiveTrajectory(trajectoryId: string): Promise<boolean> {
    const trajectory = this.trajectories.get(trajectoryId);
    if (!trajectory || trajectory.status === "archived") return false;
    this.stopWorker(trajectory.id);
    const turn = this.activeTurn(trajectory.id);
    if (turn) {
      turn.status = "cancelled";
      turn.finishedAt = this.now();
      this.addEvent(
        turn.id,
        "status",
        "Turn stopped because the trajectory was archived",
      );
    }
    trajectory.status = "archived";
    trajectory.updatedAt = this.now();
    return true;
  }

  private startWorker(trajectoryId: string, turnId: string): void {
    const trajectory = this.trajectories.get(trajectoryId);
    if (!trajectory) return;
    const model = getModel(trajectory.modelId);
    const controller = new AbortController();
    this.activeWorkers.set(trajectoryId, controller);
    this.addEvent(turnId, "status", `${model.name} dummy worker started`);
    void this.worker
      .run({
        modelName: model.name,
        taskPrompt: trajectory.taskPrompt,
        signal: controller.signal,
        emit: ({ kind, data }) => {
          const currentTrajectory = this.trajectories.get(trajectoryId);
          const turn = this.turns.get(turnId);
          if (
            currentTrajectory?.status === "running" &&
            turn?.status === "running"
          ) {
            this.addEvent(turnId, kind, data);
            currentTrajectory.updatedAt = this.now();
          }
        },
      })
      .then(() => {
        const trajectory = this.trajectories.get(trajectoryId);
        const turn = this.turns.get(turnId);
        if (trajectory?.status === "running" && turn?.status === "running") {
          turn.status = "succeeded";
          turn.finishedAt = this.now();
          trajectory.status = "succeeded";
          trajectory.updatedAt = this.now();
          this.addEvent(turnId, "status", "Trajectory finished");
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const trajectory = this.trajectories.get(trajectoryId);
        const turn = this.turns.get(turnId);
        if (trajectory?.status === "running" && turn?.status === "running") {
          turn.status = "failed";
          turn.finishedAt = this.now();
          trajectory.status = "failed";
          trajectory.updatedAt = this.now();
          const message =
            error instanceof Error ? error.message : String(error);
          this.addEvent(turnId, "system", `Worker failed: ${message}`);
          this.addEvent(turnId, "status", "Trajectory failed");
        }
      })
      .finally(() => {
        if (this.activeWorkers.get(trajectoryId) === controller) {
          this.activeWorkers.delete(trajectoryId);
        }
      });
  }

  private stopWorker(trajectoryId: string): void {
    this.activeWorkers.get(trajectoryId)?.abort();
    this.activeWorkers.delete(trajectoryId);
  }

  private activeTurn(trajectoryId: string): Turn | undefined {
    return [...this.turns.values()].find(
      (turn) =>
        turn.trajectoryId === trajectoryId &&
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
          .filter((event) => event.trajectoryId === turn.trajectoryId)
          .map((event) => event.sequence),
      ) + 1;
    const event: RunEvent = {
      id: this.id("event"),
      trajectoryId: turn.trajectoryId,
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
    return [...this.trajectories.values()].some(
      (trajectory) => trajectory.repoId === id,
    );
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

    const trajectories: Trajectory[] = [
      this.fixtureTrajectory(
        "trajectory-m3",
        "Prototype the trajectory UI",
        "repo-garage",
        "running",
        32,
      ),
      this.fixtureTrajectory(
        "trajectory-navigation",
        "Tighten dashboard navigation",
        "repo-garage",
        "awaiting_feedback",
        24,
        "trajectory-m3",
      ),
      this.fixtureTrajectory(
        "trajectory-tests",
        "Add rendering safety tests",
        "repo-garage",
        "succeeded",
        18,
        "trajectory-m3",
      ),
      this.fixtureTrajectory(
        "trajectory-parser",
        "Investigate bytecode parse failure",
        "repo-parser",
        "failed",
        140,
      ),
      this.fixtureTrajectory(
        "trajectory-docs",
        "Refresh project notes",
        "repo-notes",
        "archived",
        1_400,
      ),
      this.fixtureTrajectory(
        "trajectory-queued",
        "Audit mobile spacing",
        "repo-garage",
        "queued",
        8,
        "trajectory-m3",
      ),
    ];
    for (const trajectory of trajectories)
      this.trajectories.set(trajectory.id, trajectory);

    for (const trajectory of trajectories) {
      const status =
        trajectory.status === "running" || trajectory.status === "queued"
          ? trajectory.status
          : trajectory.status === "failed"
            ? "failed"
            : "succeeded";
      const turn: Turn = {
        id: `turn-${trajectory.id}`,
        trajectoryId: trajectory.id,
        kind: trajectory.parentId ? "spawn" : "initial",
        prompt: trajectory.taskPrompt,
        status,
        createdAt: trajectory.createdAt,
        ...(status === "running" || status === "queued"
          ? {}
          : { finishedAt: trajectory.updatedAt }),
      };
      this.turns.set(turn.id, turn);
      this.addEvent(
        turn.id,
        "status",
        status === "running"
          ? `${getModel(trajectory.modelId).name} is working via OpenRouter`
          : `Trajectory ${status}`,
        trajectory.createdAt,
      );
      this.addEvent(
        turn.id,
        "log",
        `Loaded ${trajectory.repoId} on a prototype workspace`,
        minutesAgo(Math.max(1, 30)),
      );
      this.addEvent(
        turn.id,
        "log",
        trajectory.status === "failed"
          ? "Command exited with status 1 (fixture)"
          : "Reviewed the requested files (fixture)",
        trajectory.updatedAt,
      );
    }
  }

  private fixtureTrajectory(
    id: string,
    title: string,
    repoId: string,
    status: Trajectory["status"],
    minutes: number,
    parentId?: string,
  ): Trajectory {
    return {
      id,
      ...(parentId === undefined ? {} : { parentId }),
      rootId: parentId ? "trajectory-m3" : id,
      repoId,
      title,
      status,
      modelId:
        id === "trajectory-docs"
          ? "z-ai/glm-5.2"
          : id === "trajectory-parser"
            ? "moonshotai/kimi-k3"
            : id === "trajectory-tests"
              ? "anthropic/claude-opus-5"
              : "openai/gpt-5.6-sol",
      taskPrompt: title,
      createPr: id !== "trajectory-parser",
      autoMerge: id === "trajectory-tests",
      createdAt: minutesAgo(minutes + 15),
      updatedAt: minutesAgo(minutes),
    };
  }
}
