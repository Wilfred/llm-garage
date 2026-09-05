import { randomUUID } from "node:crypto";
import type { DataSource, EntityManager, Repository } from "typeorm";
import { RepoEntity } from "../entities/repo";
import { RunEventEntity } from "../entities/run-event";
import { SessionEntity } from "../entities/session";
import { TurnEntity } from "../entities/turn";
import { getModel, isModelId } from "../models";
import { DummyWorker } from "../worker/dummy";
import type { SessionWorker, WorkerEvent } from "../worker/types";
import { RepoAlreadyExistsError } from "./errors";
import { MemoryDataStore, type MemoryStoreOptions } from "./memory";
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

export class DatabaseDataStore implements DataStore {
  private readonly repoRepository: Repository<RepoEntity>;
  private readonly sessionRepository: Repository<SessionEntity>;
  private readonly turnRepository: Repository<TurnEntity>;
  private readonly eventRepository: Repository<RunEventEntity>;
  private readonly activeWorkers = new Map<string, AbortController>();
  private readonly worker: SessionWorker;
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
    this.sessionRepository = dataSource.getRepository(SessionEntity);
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

  async deleteRepo(id: string): Promise<DeleteRepoResult> {
    return this.dataSource.transaction(async (manager) => {
      const repoRepository = manager.getRepository(RepoEntity);
      if (!(await repoRepository.existsBy({ id }))) return "not_found";
      if (await manager.getRepository(SessionEntity).existsBy({ repoId: id })) {
        return "in_use";
      }
      await repoRepository.delete({ id });
      return "deleted";
    });
  }

  async listSessions(): Promise<Session[]> {
    const sessions = await this.sessionRepository.find({
      order: { updatedAt: "DESC" },
    });
    return sessions.map(toSession);
  }

  async getSession(id: string): Promise<Session | undefined> {
    const session = await this.sessionRepository.findOneBy({ id });
    return session ? toSession(session) : undefined;
  }

  async createSession(input: CreateSessionInput): Promise<Session> {
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
            .getRepository(SessionEntity)
            .findOneBy({ id: input.parentId })
        : null;
      if (input.parentId && !parent)
        throw new Error("Parent session not found");
      if (parent && parent.repoId !== input.repoId) {
        throw new Error("Parent session belongs to a different repository");
      }

      const now = this.now();
      const id = randomUUID();
      const session = await manager.getRepository(SessionEntity).save({
        id,
        parentId: parent?.id ?? null,
        rootId: parent?.rootId ?? id,
        repoId: input.repoId,
        title: input.title,
        status: "running",
        modelId: input.modelId,
        taskPrompt: input.taskPrompt,
        createPr: input.createPr,
        autoMerge: input.autoMerge,
        prUrl: null,
        createdAt: now,
        updatedAt: now,
      });
      const turn = await manager.getRepository(TurnEntity).save({
        id: randomUUID(),
        sessionId: session.id,
        kind: parent ? "spawn" : "initial",
        prompt: input.taskPrompt,
        status: "running",
        createdAt: now,
        finishedAt: null,
      });
      await this.appendEvent(
        manager,
        session.id,
        turn.id,
        "status",
        `${getModel(input.modelId).name} dummy worker started`,
        now,
      );
      return { session: toSession(session), turnId: turn.id };
    });

    this.startWorker(result.session.id, result.turnId);
    return result.session;
  }

  async listTurns(sessionId: string): Promise<Turn[]> {
    const turns = await this.turnRepository.find({
      where: { sessionId },
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

  async addFeedback(sessionId: string, feedback: string): Promise<Turn> {
    const turn = await this.dataSource.transaction(async (manager) => {
      const sessionRepository = manager.getRepository(SessionEntity);
      const session = await sessionRepository.findOneBy({ id: sessionId });
      if (!session) throw new Error("Session not found");
      if (
        session.status === "archived" ||
        session.status === "running" ||
        session.status === "queued"
      ) {
        throw new Error("This session cannot accept feedback right now");
      }

      const now = this.now();
      const created = await manager.getRepository(TurnEntity).save({
        id: randomUUID(),
        sessionId,
        kind: "feedback",
        prompt: feedback,
        status: "running",
        createdAt: now,
        finishedAt: null,
      });
      session.status = "running";
      session.updatedAt = now;
      await sessionRepository.save(session);
      await this.appendEvent(
        manager,
        session.id,
        created.id,
        "status",
        `${getModel(toSession(session).modelId).name} dummy worker started`,
        now,
      );
      return toTurn(created);
    });

    this.startWorker(sessionId, turn.id);
    return turn;
  }

  async cancelSession(sessionId: string): Promise<boolean> {
    this.stopWorker(sessionId);
    return this.dataSource.transaction(async (manager) => {
      const sessionRepository = manager.getRepository(SessionEntity);
      const session = await sessionRepository.findOneBy({ id: sessionId });
      if (
        !session ||
        (session.status !== "running" && session.status !== "queued")
      ) {
        return false;
      }

      const now = this.now();
      session.status = "cancelled";
      session.updatedAt = now;
      await sessionRepository.save(session);
      const turn = await this.activeTurn(manager, sessionId);
      if (turn) {
        turn.status = "cancelled";
        turn.finishedAt = now;
        await manager.getRepository(TurnEntity).save(turn);
        await this.appendEvent(
          manager,
          sessionId,
          turn.id,
          "status",
          "Session cancelled by user",
          now,
        );
      }
      return true;
    });
  }

  async archiveSession(sessionId: string): Promise<boolean> {
    this.stopWorker(sessionId);
    return this.dataSource.transaction(async (manager) => {
      const sessionRepository = manager.getRepository(SessionEntity);
      const session = await sessionRepository.findOneBy({ id: sessionId });
      if (!session || session.status === "archived") return false;

      const now = this.now();
      const activeTurn = await this.activeTurn(manager, sessionId);
      const eventTurn =
        activeTurn ?? (await this.latestTurn(manager, sessionId));
      if (activeTurn) {
        activeTurn.status = "cancelled";
        activeTurn.finishedAt = now;
        await manager.getRepository(TurnEntity).save(activeTurn);
      }
      if (eventTurn) {
        await this.appendEvent(
          manager,
          sessionId,
          eventTurn.id,
          "status",
          activeTurn
            ? "Turn stopped because the session was archived"
            : "Session archived",
          now,
        );
      }
      session.status = "archived";
      session.updatedAt = now;
      await sessionRepository.save(session);
      return true;
    });
  }

  private startWorker(sessionId: string, turnId: string): void {
    const controller = new AbortController();
    this.activeWorkers.set(sessionId, controller);
    void this.runWorker(sessionId, turnId, controller);
  }

  private async runWorker(
    sessionId: string,
    turnId: string,
    controller: AbortController,
  ): Promise<void> {
    let writes = Promise.resolve();
    try {
      const session = await this.getSession(sessionId);
      if (!session) return;
      let workerError: unknown;
      try {
        await this.worker.run({
          modelName: getModel(session.modelId).name,
          taskPrompt: session.taskPrompt,
          signal: controller.signal,
          emit: (event) => {
            writes = writes.then(() =>
              this.recordWorkerEvent(sessionId, turnId, event),
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
      await this.finishWorker(sessionId, turnId);
    } catch (error) {
      if (!controller.signal.aborted) {
        try {
          await this.failWorker(sessionId, turnId, error);
        } catch (storageError) {
          console.error(
            `Failed to persist worker failure for session ${sessionId}`,
            storageError,
          );
        }
      }
    } finally {
      if (this.activeWorkers.get(sessionId) === controller) {
        this.activeWorkers.delete(sessionId);
      }
    }
  }

  private async recordWorkerEvent(
    sessionId: string,
    turnId: string,
    event: WorkerEvent,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const session = await manager
        .getRepository(SessionEntity)
        .findOneBy({ id: sessionId });
      const turn = await manager
        .getRepository(TurnEntity)
        .findOneBy({ id: turnId });
      if (session?.status !== "running" || turn?.status !== "running") return;

      const now = this.now();
      session.updatedAt = now;
      await manager.getRepository(SessionEntity).save(session);
      await this.appendEvent(
        manager,
        sessionId,
        turnId,
        event.kind,
        event.data,
        now,
      );
    });
  }

  private async finishWorker(sessionId: string, turnId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const session = await manager
        .getRepository(SessionEntity)
        .findOneBy({ id: sessionId });
      const turn = await manager
        .getRepository(TurnEntity)
        .findOneBy({ id: turnId });
      if (session?.status !== "running" || turn?.status !== "running") return;

      const now = this.now();
      turn.status = "succeeded";
      turn.finishedAt = now;
      session.status = "succeeded";
      session.updatedAt = now;
      await manager.getRepository(TurnEntity).save(turn);
      await manager.getRepository(SessionEntity).save(session);
      await this.appendEvent(
        manager,
        sessionId,
        turnId,
        "status",
        "Session finished",
        now,
      );
    });
  }

  private async failWorker(
    sessionId: string,
    turnId: string,
    error: unknown,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const session = await manager
        .getRepository(SessionEntity)
        .findOneBy({ id: sessionId });
      const turn = await manager
        .getRepository(TurnEntity)
        .findOneBy({ id: turnId });
      if (session?.status !== "running" || turn?.status !== "running") return;

      const now = this.now();
      turn.status = "failed";
      turn.finishedAt = now;
      session.status = "failed";
      session.updatedAt = now;
      await manager.getRepository(TurnEntity).save(turn);
      await manager.getRepository(SessionEntity).save(session);
      const message = error instanceof Error ? error.message : String(error);
      await this.appendEvent(
        manager,
        sessionId,
        turnId,
        "system",
        `Worker failed: ${message}`,
        now,
      );
      await this.appendEvent(
        manager,
        sessionId,
        turnId,
        "status",
        "Session failed",
        now,
      );
    });
  }

  private async activeTurn(
    manager: EntityManager,
    sessionId: string,
  ): Promise<TurnEntity | null> {
    return manager.getRepository(TurnEntity).findOne({
      where: [
        { sessionId, status: "running" },
        { sessionId, status: "queued" },
      ],
      order: { createdAt: "DESC" },
    });
  }

  private async latestTurn(
    manager: EntityManager,
    sessionId: string,
  ): Promise<TurnEntity | null> {
    return manager.getRepository(TurnEntity).findOne({
      where: { sessionId },
      order: { createdAt: "DESC" },
    });
  }

  private async appendEvent(
    manager: EntityManager,
    sessionId: string,
    turnId: string,
    kind: RunEvent["kind"],
    data: string,
    ts: Date,
  ): Promise<RunEventEntity> {
    const repository = manager.getRepository(RunEventEntity);
    const previous = await repository.findOne({
      where: { sessionId },
      order: { sequence: "DESC" },
    });
    return repository.save({
      id: randomUUID(),
      sessionId,
      turnId,
      sequence: (previous?.sequence ?? 0) + 1,
      kind,
      data,
      ts,
    });
  }

  private stopWorker(sessionId: string): void {
    this.activeWorkers.get(sessionId)?.abort();
    this.activeWorkers.delete(sessionId);
  }

  private now(): Date {
    this.lastTimestamp = Math.max(Date.now(), this.lastTimestamp + 1);
    return new Date(this.lastTimestamp);
  }
}

function toSession(entity: SessionEntity): Session {
  if (!isModelId(entity.modelId)) {
    throw new Error(`Session ${entity.id} has unknown model ${entity.modelId}`);
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
    createPr: entity.createPr,
    autoMerge: entity.autoMerge,
    ...(entity.prUrl === null ? {} : { prUrl: entity.prUrl }),
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

function toTurn(entity: TurnEntity): Turn {
  return {
    id: entity.id,
    sessionId: entity.sessionId,
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
    sessionId: entity.sessionId,
    turnId: entity.turnId,
    sequence: entity.sequence,
    kind: entity.kind,
    data: entity.data,
    ts: entity.ts,
  };
}
