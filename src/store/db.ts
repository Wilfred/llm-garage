import { randomUUID } from "node:crypto";
import type { DataSource, EntityManager, Repository } from "typeorm";
import { RepoEntity } from "../entities/repo";
import { RunEventEntity } from "../entities/run-event";
import { TrajectoryEntity } from "../entities/trajectory";
import { TurnEntity } from "../entities/turn";
import { getModel, isModelId } from "../models";
import { DummyWorker } from "../worker/dummy";
import type {
  ConversationMessage,
  TrajectoryWorker,
  WorkerEvent,
} from "../worker/types";
import { RepoAlreadyExistsError } from "./errors";
import { MemoryDataStore, type MemoryStoreOptions } from "./memory";
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

export class DatabaseDataStore implements DataStore {
  private readonly repoRepository: Repository<RepoEntity>;
  private readonly trajectoryRepository: Repository<TrajectoryEntity>;
  private readonly turnRepository: Repository<TurnEntity>;
  private readonly eventRepository: Repository<RunEventEntity>;
  private readonly activeWorkers = new Map<string, AbortController>();
  private readonly worker: TrajectoryWorker;
  private readonly seed: boolean;
  private lastTimestamp = 0;

  constructor(
    private readonly dataSource: DataSource,
    {
      seed = true,
      simulationStepMs = 500,
      worker = new DummyWorker({ stepDelayMs: simulationStepMs }),
    }: MemoryStoreOptions = {},
  ) {
    this.repoRepository = dataSource.getRepository(RepoEntity);
    this.trajectoryRepository = dataSource.getRepository(TrajectoryEntity);
    this.turnRepository = dataSource.getRepository(TurnEntity);
    this.eventRepository = dataSource.getRepository(RunEventEntity);
    this.worker = worker;
    this.seed = seed;
  }

  async initialize(): Promise<void> {
    if (this.seed && (await this.repoRepository.count()) === 0) {
      const prototypeStore = new MemoryDataStore();
      await this.repoRepository.save(await prototypeStore.listRepos());
    }
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
    return this.dataSource.transaction(async (manager) => {
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

  async getTrajectory(id: string): Promise<Trajectory | undefined> {
    const trajectory = await this.trajectoryRepository.findOneBy({ id });
    return trajectory ? toTrajectory(trajectory) : undefined;
  }

  async createTrajectory(input: CreateTrajectoryInput): Promise<Trajectory> {
    const result = await this.dataSource.transaction(async (manager) => {
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

      const now = this.now();
      const id = randomUUID();
      const trajectory = await manager.getRepository(TrajectoryEntity).save({
        id,
        parentId: parent?.id ?? null,
        rootId: parent?.rootId ?? id,
        repoId: input.repoId,
        title: input.title,
        status: "running",
        modelId: input.modelId,
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
        `${getModel(input.modelId).name} started`,
        now,
      );
      return { trajectory: toTrajectory(trajectory), turnId: turn.id };
    });

    this.startWorker(result.trajectory.id, result.turnId);
    return result.trajectory;
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
    const turn = await this.dataSource.transaction(async (manager) => {
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
        `${getModel(toTrajectory(trajectory).modelId).name} started`,
        now,
      );
      return toTurn(created);
    });

    this.startWorker(trajectoryId, turn.id);
    return turn;
  }

  async cancelTrajectory(trajectoryId: string): Promise<boolean> {
    this.stopWorker(trajectoryId);
    return this.dataSource.transaction(async (manager) => {
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
    return this.dataSource.transaction(async (manager) => {
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
      const messages = await this.conversationMessages(trajectoryId);
      let workerError: unknown;
      try {
        await this.worker.run({
          modelId: trajectory.modelId,
          modelName: getModel(trajectory.modelId).name,
          messages,
          signal: controller.signal,
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
    await this.dataSource.transaction(async (manager) => {
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
    await this.dataSource.transaction(async (manager) => {
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
    await this.dataSource.transaction(async (manager) => {
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
  if (!isModelId(entity.modelId)) {
    throw new Error(
      `Trajectory ${entity.id} has unknown model ${entity.modelId}`,
    );
  }
  return {
    id: entity.id,
    ...(entity.parentId === null ? {} : { parentId: entity.parentId }),
    rootId: entity.rootId,
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
  return {
    id: entity.id,
    trajectoryId: entity.trajectoryId,
    kind: entity.kind,
    prompt: entity.prompt,
    status: entity.status,
    createdAt: entity.createdAt,
    ...(entity.finishedAt === null ? {} : { finishedAt: entity.finishedAt }),
  };
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
