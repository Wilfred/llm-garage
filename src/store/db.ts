import { randomUUID } from "node:crypto";
import { Mutex } from "async-mutex";
import type { DataSource, EntityManager, Repository } from "typeorm";
import { ModelEntity } from "../entities/model";
import { RepoEntity } from "../entities/repo";
import { RunEventEntity } from "../entities/run-event";
import { TrajectoryEntity } from "../entities/trajectory";
import { TurnEntity } from "../entities/turn";
import { DisabledSandbox, type Sandbox } from "../sandbox/types";
import { addUsage, sumUsage, type TokenUsage } from "../usage";
import { DummyWorker } from "../worker/dummy";
import type {
  ConversationMessage,
  TrajectoryWorker,
  WorkerEvent,
} from "../worker/types";
import { ModelAlreadyExistsError, RepoAlreadyExistsError } from "./errors";
import { createStarterModels, createStarterRepos } from "./seed";
import type {
  CreateModelInput,
  CreateRepoInput,
  CreateTrajectoriesInput,
  DataStore,
  DeleteModelResult,
  DeleteRepoResult,
  Model,
  Repo,
  RunEvent,
  SpendGroup,
  SpendReport,
  SpendTotals,
  Trajectory,
  Turn,
  UpdateModelInput,
} from "./types";

export type DatabaseStoreOptions = {
  seed?: boolean;
  simulationStepMs?: number;
  worker?: TrajectoryWorker;
  sandbox?: Sandbox;
};

export class DatabaseDataStore implements DataStore {
  private readonly modelRepository: Repository<ModelEntity>;
  private readonly repoRepository: Repository<RepoEntity>;
  private readonly trajectoryRepository: Repository<TrajectoryEntity>;
  private readonly turnRepository: Repository<TurnEntity>;
  private readonly eventRepository: Repository<RunEventEntity>;
  private readonly activeWorkers = new Map<string, AbortController>();
  // The better-sqlite3 driver holds a single connection, so overlapping
  // transactions from concurrent workers would nest and fail.
  private readonly writeLock = new Mutex();
  private readonly worker: TrajectoryWorker;
  private readonly sandbox: Sandbox;
  private readonly seed: boolean;
  private lastTimestamp = 0;

  constructor(
    private readonly dataSource: DataSource,
    {
      seed = true,
      simulationStepMs = 500,
      worker = new DummyWorker({ stepDelayMs: simulationStepMs }),
      sandbox = new DisabledSandbox(),
    }: DatabaseStoreOptions = {},
  ) {
    this.modelRepository = dataSource.getRepository(ModelEntity);
    this.repoRepository = dataSource.getRepository(RepoEntity);
    this.trajectoryRepository = dataSource.getRepository(TrajectoryEntity);
    this.turnRepository = dataSource.getRepository(TurnEntity);
    this.eventRepository = dataSource.getRepository(RunEventEntity);
    this.worker = worker;
    this.sandbox = sandbox;
    this.seed = seed;
  }

  async initialize(): Promise<void> {
    if (!this.seed) return;
    if ((await this.repoRepository.count()) === 0) {
      await this.repoRepository.save(createStarterRepos());
    }
    if ((await this.modelRepository.count()) === 0) {
      await this.modelRepository.save(createStarterModels());
    }
  }

  async listModels(): Promise<Model[]> {
    return this.modelRepository.find({ order: { createdAt: "ASC" } });
  }

  async getModel(id: string): Promise<Model | undefined> {
    return (await this.modelRepository.findOneBy({ id })) ?? undefined;
  }

  async createModel(input: CreateModelInput): Promise<Model> {
    if (await this.modelRepository.existsBy({ id: input.id })) {
      throw new ModelAlreadyExistsError(input.id);
    }
    return this.modelRepository.save(
      this.modelRepository.create({ ...input, createdAt: new Date() }),
    );
  }

  async updateModel(
    id: string,
    input: UpdateModelInput,
  ): Promise<Model | undefined> {
    const model = await this.modelRepository.findOneBy({ id });
    if (!model) return undefined;
    return this.modelRepository.save(Object.assign(model, input));
  }

  async deleteModel(id: string): Promise<DeleteModelResult> {
    return this.transaction(async (manager) => {
      const modelRepository = manager.getRepository(ModelEntity);
      if (!(await modelRepository.existsBy({ id }))) return "not_found";
      if (
        await manager.getRepository(TrajectoryEntity).existsBy({ modelId: id })
      ) {
        return "in_use";
      }
      await modelRepository.delete({ id });
      return "deleted";
    });
  }

  async listRepos(): Promise<Repo[]> {
    return this.repoRepository.find({ order: { createdAt: "DESC" } });
  }

  async getRepo(id: string): Promise<Repo | undefined> {
    return (await this.repoRepository.findOneBy({ id })) ?? undefined;
  }

  async createRepo(input: CreateRepoInput): Promise<Repo> {
    const existing = await this.repoRepository.findOneBy({
      owner: input.owner,
      name: input.name,
    });
    if (existing) throw new RepoAlreadyExistsError(input.owner, input.name);

    return this.repoRepository.save(
      this.repoRepository.create({
        id: randomUUID(),
        ...input,
        createdAt: new Date(),
      }),
    );
  }

  async setRepoAutoMerge(id: string, autoMerge: boolean): Promise<boolean> {
    const result = await this.repoRepository.update({ id }, { autoMerge });
    return result.affected !== 0;
  }

  async deleteRepo(id: string): Promise<DeleteRepoResult> {
    return this.transaction(async (manager) => {
      const repoRepository = manager.getRepository(RepoEntity);
      if (!(await repoRepository.existsBy({ id }))) return "not_found";
      if (
        await manager.getRepository(TrajectoryEntity).existsBy({ repoId: id })
      ) {
        return "in_use";
      }
      await repoRepository.delete({ id });
      return "deleted";
    });
  }

  async listTrajectories(): Promise<Trajectory[]> {
    const trajectories = await this.trajectoryRepository.find({
      order: { updatedAt: "DESC" },
    });
    return trajectories.map(toTrajectory);
  }

  async getSpend(): Promise<SpendReport> {
    const [models, repos, trajectories, turns] = await Promise.all([
      this.listModels(),
      this.listRepos(),
      this.listTrajectories(),
      this.turnRepository.find({
        select: {
          trajectoryId: true,
          inputTokens: true,
          outputTokens: true,
          costUsd: true,
        },
      }),
    ]);

    const usageByTrajectory = new Map<string, TokenUsage>();
    let unpricedTurns = 0;
    for (const turn of turns) {
      const usage = toUsage(turn);
      if (!usage) continue;
      if (usage.costUsd === undefined) unpricedTurns += 1;
      usageByTrajectory.set(
        turn.trajectoryId,
        addUsage(usageByTrajectory.get(turn.trajectoryId), usage),
      );
    }

    return {
      ...spendTotals(trajectories, usageByTrajectory),
      byModel: groupSpend(trajectories, usageByTrajectory, (trajectory) => ({
        id: trajectory.modelId,
        label:
          models.find(({ id }) => id === trajectory.modelId)?.name ??
          trajectory.modelId,
      })),
      byRepo: groupSpend(trajectories, usageByTrajectory, (trajectory) => {
        const repo = repos.find(({ id }) => id === trajectory.repoId);
        return {
          id: trajectory.repoId,
          label: repo ? `${repo.owner}/${repo.name}` : "Unknown repository",
        };
      }),
      unpricedTurns,
    };
  }

  async getTrajectory(id: string): Promise<Trajectory | undefined> {
    const trajectory = await this.trajectoryRepository.findOneBy({ id });
    return trajectory ? toTrajectory(trajectory) : undefined;
  }

  async createTrajectories(
    input: CreateTrajectoriesInput,
  ): Promise<Trajectory[]> {
    if (input.modelIds.length === 0) throw new Error("No models selected");

    const created = await this.transaction(async (manager) => {
      if (
        !(await manager
          .getRepository(RepoEntity)
          .existsBy({ id: input.repoId }))
      ) {
        throw new Error("Repository not found");
      }

      const parent = input.parentId
        ? await manager
            .getRepository(TrajectoryEntity)
            .findOneBy({ id: input.parentId })
        : null;
      if (input.parentId && !parent)
        throw new Error("Parent trajectory not found");
      if (parent && parent.repoId !== input.repoId) {
        throw new Error("Parent trajectory belongs to a different repository");
      }

      const comparisonId = input.modelIds.length > 1 ? randomUUID() : null;
      const started: Array<{ trajectory: Trajectory; turnId: string }> = [];
      for (const modelId of input.modelIds) {
        const model = await manager
          .getRepository(ModelEntity)
          .findOneBy({ id: modelId });
        if (!model) throw new Error(`Unknown model: ${modelId}`);
        const now = this.now();
        const id = randomUUID();
        const trajectory = await manager.getRepository(TrajectoryEntity).save({
          id,
          parentId: parent?.id ?? null,
          rootId: parent?.rootId ?? id,
          comparisonId,
          repoId: input.repoId,
          title: input.title,
          status: "running",
          modelId,
          taskPrompt: input.taskPrompt,
          prUrl: null,
          createdAt: now,
          updatedAt: now,
        });
        const turn = await manager.getRepository(TurnEntity).save({
          id: randomUUID(),
          trajectoryId: trajectory.id,
          kind: parent ? "spawn" : "initial",
          prompt: input.taskPrompt,
          status: "running",
          createdAt: now,
          finishedAt: null,
        });
        await this.appendEvent(
          manager,
          trajectory.id,
          turn.id,
          "status",
          `${model.name} started`,
          now,
        );
        started.push({ trajectory: toTrajectory(trajectory), turnId: turn.id });
      }
      return started;
    });

    for (const { trajectory, turnId } of created)
      this.startWorker(trajectory.id, turnId);
    return created.map(({ trajectory }) => trajectory);
  }

  async listComparison(comparisonId: string): Promise<Trajectory[]> {
    const trajectories = await this.trajectoryRepository.find({
      where: { comparisonId },
      order: { createdAt: "ASC" },
    });
    return trajectories.map(toTrajectory);
  }

  async listTurns(trajectoryId: string): Promise<Turn[]> {
    const turns = await this.turnRepository.find({
      where: { trajectoryId },
      order: { createdAt: "ASC" },
    });
    return turns.map(toTurn);
  }

  async listRunEvents(turnId: string): Promise<RunEvent[]> {
    const events = await this.eventRepository.find({
      where: { turnId },
      order: { sequence: "ASC" },
    });
    return events.map(toRunEvent);
  }

  async addFeedback(trajectoryId: string, feedback: string): Promise<Turn> {
    const turn = await this.transaction(async (manager) => {
      const trajectoryRepository = manager.getRepository(TrajectoryEntity);
      const trajectory = await trajectoryRepository.findOneBy({
        id: trajectoryId,
      });
      if (!trajectory) throw new Error("Trajectory not found");
      if (
        trajectory.status === "archived" ||
        trajectory.status === "running" ||
        trajectory.status === "queued"
      ) {
        throw new Error("This trajectory cannot accept feedback right now");
      }

      const model = await manager
        .getRepository(ModelEntity)
        .findOneBy({ id: trajectory.modelId });

      const now = this.now();
      const created = await manager.getRepository(TurnEntity).save({
        id: randomUUID(),
        trajectoryId,
        kind: "feedback",
        prompt: feedback,
        status: "running",
        createdAt: now,
        finishedAt: null,
      });
      trajectory.status = "running";
      trajectory.updatedAt = now;
      await trajectoryRepository.save(trajectory);
      await this.appendEvent(
        manager,
        trajectory.id,
        created.id,
        "status",
        `${model?.name ?? trajectory.modelId} started`,
        now,
      );
      return toTurn(created);
    });

    this.startWorker(trajectoryId, turn.id);
    return turn;
  }

  async cancelTrajectory(trajectoryId: string): Promise<boolean> {
    this.stopWorker(trajectoryId);
    return this.transaction(async (manager) => {
      const trajectoryRepository = manager.getRepository(TrajectoryEntity);
      const trajectory = await trajectoryRepository.findOneBy({
        id: trajectoryId,
      });
      if (
        !trajectory ||
        (trajectory.status !== "running" && trajectory.status !== "queued")
      ) {
        return false;
      }

      const now = this.now();
      trajectory.status = "cancelled";
      trajectory.updatedAt = now;
      await trajectoryRepository.save(trajectory);
      const turn = await this.activeTurn(manager, trajectoryId);
      if (turn) {
        turn.status = "cancelled";
        turn.finishedAt = now;
        await manager.getRepository(TurnEntity).save(turn);
        await this.appendEvent(
          manager,
          trajectoryId,
          turn.id,
          "status",
          "Trajectory cancelled by user",
          now,
        );
      }
      return true;
    });
  }

  async archiveTrajectory(trajectoryId: string): Promise<boolean> {
    this.stopWorker(trajectoryId);
    const existing = await this.getTrajectory(trajectoryId);
    if (!existing || existing.status === "archived") return false;
    await this.sandbox.archive(trajectoryId);
    return this.transaction(async (manager) => {
      const trajectoryRepository = manager.getRepository(TrajectoryEntity);
      const trajectory = await trajectoryRepository.findOneBy({
        id: trajectoryId,
      });
      if (!trajectory || trajectory.status === "archived") return false;

      const now = this.now();
      const activeTurn = await this.activeTurn(manager, trajectoryId);
      const eventTurn =
        activeTurn ?? (await this.latestTurn(manager, trajectoryId));
      if (activeTurn) {
        activeTurn.status = "cancelled";
        activeTurn.finishedAt = now;
        await manager.getRepository(TurnEntity).save(activeTurn);
      }
      if (eventTurn) {
        await this.appendEvent(
          manager,
          trajectoryId,
          eventTurn.id,
          "status",
          activeTurn
            ? "Turn stopped because the trajectory was archived"
            : "Trajectory archived",
          now,
        );
      }
      trajectory.status = "archived";
      trajectory.updatedAt = now;
      await trajectoryRepository.save(trajectory);
      return true;
    });
  }

  private startWorker(trajectoryId: string, turnId: string): void {
    const controller = new AbortController();
    this.activeWorkers.set(trajectoryId, controller);
    void this.runWorker(trajectoryId, turnId, controller);
  }

  private async runWorker(
    trajectoryId: string,
    turnId: string,
    controller: AbortController,
  ): Promise<void> {
    let writes = Promise.resolve();
    try {
      const trajectory = await this.getTrajectory(trajectoryId);
      if (!trajectory) return;
      const model = await this.getModel(trajectory.modelId);
      if (!model) throw new Error(`Unknown model: ${trajectory.modelId}`);
      const messages = await this.conversationMessages(trajectoryId);
      await this.sandbox.create(trajectoryId);
      let workerError: unknown;
      try {
        await this.worker.run({
          modelId: model.id,
          modelName: model.name,
          effort: model.effort,
          messages,
          signal: controller.signal,
          runCommand: (command) =>
            this.sandbox.runCommand(trajectoryId, command, controller.signal),
          emit: (event) => {
            writes = writes.then(() =>
              this.recordWorkerEvent(trajectoryId, turnId, event),
            );
          },
        });
      } catch (error) {
        workerError = error;
      }

      await writes;
      if (controller.signal.aborted) return;
      if (workerError) {
        throw workerError instanceof Error
          ? workerError
          : new Error("Worker failed", { cause: workerError });
      }
      await this.finishWorker(trajectoryId, turnId);
    } catch (error) {
      if (!controller.signal.aborted) {
        try {
          await this.failWorker(trajectoryId, turnId, error);
        } catch (storageError) {
          console.error(
            `Failed to persist worker failure for trajectory ${trajectoryId}`,
            storageError,
          );
        }
      }
    } finally {
      if (this.activeWorkers.get(trajectoryId) === controller) {
        this.activeWorkers.delete(trajectoryId);
      }
    }
  }

  private async conversationMessages(
    trajectoryId: string,
  ): Promise<ConversationMessage[]> {
    const [turns, events] = await Promise.all([
      this.turnRepository.find({
        where: { trajectoryId },
        order: { createdAt: "ASC" },
      }),
      this.eventRepository.find({
        where: { trajectoryId },
        order: { sequence: "ASC" },
      }),
    ]);

    return turns.flatMap((turn) => {
      const output = events
        .filter(
          (event) => event.turnId === turn.id && event.kind === "model_output",
        )
        .map((event) => event.data)
        .join("\n");
      return [
        { role: "user" as const, content: turn.prompt },
        ...(output ? [{ role: "assistant" as const, content: output }] : []),
      ];
    });
  }

  private async recordWorkerEvent(
    trajectoryId: string,
    turnId: string,
    event: WorkerEvent,
  ): Promise<void> {
    await this.transaction(async (manager) => {
      const trajectory = await manager
        .getRepository(TrajectoryEntity)
        .findOneBy({ id: trajectoryId });
      const turn = await manager
        .getRepository(TurnEntity)
        .findOneBy({ id: turnId });
      if (trajectory?.status !== "running" || turn?.status !== "running")
        return;

      const now = this.now();
      trajectory.updatedAt = now;
      await manager.getRepository(TrajectoryEntity).save(trajectory);
      if (event.kind === "usage") {
        turn.inputTokens = (turn.inputTokens ?? 0) + event.usage.inputTokens;
        turn.outputTokens = (turn.outputTokens ?? 0) + event.usage.outputTokens;
        if (event.usage.costUsd !== undefined) {
          turn.costUsd = (turn.costUsd ?? 0) + event.usage.costUsd;
        }
        await manager.getRepository(TurnEntity).save(turn);
      }
      await this.appendEvent(
        manager,
        trajectoryId,
        turnId,
        event.kind,
        event.data,
        now,
      );
    });
  }

  private async finishWorker(
    trajectoryId: string,
    turnId: string,
  ): Promise<void> {
    await this.transaction(async (manager) => {
      const trajectory = await manager
        .getRepository(TrajectoryEntity)
        .findOneBy({ id: trajectoryId });
      const turn = await manager
        .getRepository(TurnEntity)
        .findOneBy({ id: turnId });
      if (trajectory?.status !== "running" || turn?.status !== "running")
        return;

      const now = this.now();
      turn.status = "succeeded";
      turn.finishedAt = now;
      trajectory.status = "succeeded";
      trajectory.updatedAt = now;
      await manager.getRepository(TurnEntity).save(turn);
      await manager.getRepository(TrajectoryEntity).save(trajectory);
      await this.appendEvent(
        manager,
        trajectoryId,
        turnId,
        "status",
        "Trajectory finished",
        now,
      );
    });
  }

  private async failWorker(
    trajectoryId: string,
    turnId: string,
    error: unknown,
  ): Promise<void> {
    await this.transaction(async (manager) => {
      const trajectory = await manager
        .getRepository(TrajectoryEntity)
        .findOneBy({ id: trajectoryId });
      const turn = await manager
        .getRepository(TurnEntity)
        .findOneBy({ id: turnId });
      if (trajectory?.status !== "running" || turn?.status !== "running")
        return;

      const now = this.now();
      turn.status = "failed";
      turn.finishedAt = now;
      trajectory.status = "failed";
      trajectory.updatedAt = now;
      await manager.getRepository(TurnEntity).save(turn);
      await manager.getRepository(TrajectoryEntity).save(trajectory);
      const message = error instanceof Error ? error.message : String(error);
      await this.appendEvent(
        manager,
        trajectoryId,
        turnId,
        "system",
        `Worker failed: ${message}`,
        now,
      );
      await this.appendEvent(
        manager,
        trajectoryId,
        turnId,
        "status",
        "Trajectory failed",
        now,
      );
    });
  }

  private async activeTurn(
    manager: EntityManager,
    trajectoryId: string,
  ): Promise<TurnEntity | null> {
    return manager.getRepository(TurnEntity).findOne({
      where: [
        { trajectoryId, status: "running" },
        { trajectoryId, status: "queued" },
      ],
      order: { createdAt: "DESC" },
    });
  }

  private async latestTurn(
    manager: EntityManager,
    trajectoryId: string,
  ): Promise<TurnEntity | null> {
    return manager.getRepository(TurnEntity).findOne({
      where: { trajectoryId },
      order: { createdAt: "DESC" },
    });
  }

  private async appendEvent(
    manager: EntityManager,
    trajectoryId: string,
    turnId: string,
    kind: RunEvent["kind"],
    data: string,
    ts: Date,
  ): Promise<RunEventEntity> {
    const repository = manager.getRepository(RunEventEntity);
    const previous = await repository.findOne({
      where: { trajectoryId },
      order: { sequence: "DESC" },
    });
    return repository.save({
      id: randomUUID(),
      trajectoryId,
      turnId,
      sequence: (previous?.sequence ?? 0) + 1,
      kind,
      data,
      ts,
    });
  }

  private transaction<T>(
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.writeLock.runExclusive(() => this.dataSource.transaction(work));
  }

  private stopWorker(trajectoryId: string): void {
    this.activeWorkers.get(trajectoryId)?.abort();
    this.activeWorkers.delete(trajectoryId);
  }

  private now(): Date {
    this.lastTimestamp = Math.max(Date.now(), this.lastTimestamp + 1);
    return new Date(this.lastTimestamp);
  }
}

function toTrajectory(entity: TrajectoryEntity): Trajectory {
  return {
    id: entity.id,
    ...(entity.parentId === null ? {} : { parentId: entity.parentId }),
    rootId: entity.rootId,
    ...(entity.comparisonId === null
      ? {}
      : { comparisonId: entity.comparisonId }),
    repoId: entity.repoId,
    title: entity.title,
    status: entity.status,
    modelId: entity.modelId,
    taskPrompt: entity.taskPrompt,
    ...(entity.prUrl === null ? {} : { prUrl: entity.prUrl }),
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

function toTurn(entity: TurnEntity): Turn {
  const usage = toUsage(entity);
  return {
    id: entity.id,
    trajectoryId: entity.trajectoryId,
    kind: entity.kind,
    prompt: entity.prompt,
    status: entity.status,
    ...(usage === undefined ? {} : { usage }),
    createdAt: entity.createdAt,
    ...(entity.finishedAt === null ? {} : { finishedAt: entity.finishedAt }),
  };
}

function toUsage(entity: TurnEntity): TokenUsage | undefined {
  if (entity.inputTokens === null && entity.outputTokens === null) {
    return undefined;
  }
  return {
    inputTokens: entity.inputTokens ?? 0,
    outputTokens: entity.outputTokens ?? 0,
    ...(entity.costUsd === null ? {} : { costUsd: entity.costUsd }),
  };
}

function spendTotals(
  trajectories: Trajectory[],
  usageByTrajectory: Map<string, TokenUsage>,
): SpendTotals {
  const usage = sumUsage(
    trajectories.map(({ id }) => usageByTrajectory.get(id)),
  );
  return {
    trajectories: trajectories.length,
    ...(usage === undefined ? {} : { usage }),
  };
}

function groupSpend(
  trajectories: Trajectory[],
  usageByTrajectory: Map<string, TokenUsage>,
  key: (trajectory: Trajectory) => { id: string; label: string },
): SpendGroup[] {
  const groups = new Map<string, { label: string; members: Trajectory[] }>();
  for (const trajectory of trajectories) {
    const { id, label } = key(trajectory);
    const group = groups.get(id) ?? { label, members: [] };
    group.members.push(trajectory);
    groups.set(id, group);
  }
  return [...groups]
    .map(([id, { label, members }]) => ({
      id,
      label,
      ...spendTotals(members, usageByTrajectory),
    }))
    .sort(
      (left, right) =>
        (right.usage?.costUsd ?? 0) - (left.usage?.costUsd ?? 0) ||
        right.trajectories - left.trajectories,
    );
}

function toRunEvent(entity: RunEventEntity): RunEvent {
  return {
    id: entity.id,
    trajectoryId: entity.trajectoryId,
    turnId: entity.turnId,
    sequence: entity.sequence,
    kind: entity.kind,
    data: entity.data,
    ts: entity.ts,
  };
}
