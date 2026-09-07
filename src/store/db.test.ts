import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { DataSource } from "typeorm";
import { createAppDataSource } from "../db/data-source";
import { RepoAlreadyExistsError } from "./errors";
import { DatabaseDataStore } from "./db";
import type {
  CreateTrajectoriesInput,
  DataStore,
  Trajectory,
  TrajectoryStatus,
} from "./types";
import { formatUsage, type TokenUsage } from "../usage";
import type { ConversationMessage } from "../worker/types";
import type { Sandbox } from "../sandbox/types";

void test("persists repository CRUD across data source restarts", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "llm-garage-repos-"));
  let dataSource: DataSource | undefined;

  t.after(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
    await rm(dataDir, { recursive: true, force: true });
  });

  dataSource = createAppDataSource(dataDir);
  await dataSource.initialize();
  let store = new DatabaseDataStore(dataSource);
  await store.initialize();

  assert.equal((await store.listRepos()).length, 3);
  const created = await store.createRepo({
    owner: "example",
    name: "persistent-project",
    defaultBranch: "trunk",
    autoMerge: false,
  });
  await dataSource.destroy();

  dataSource = createAppDataSource(dataDir);
  await dataSource.initialize();
  store = new DatabaseDataStore(dataSource);
  await store.initialize();

  assert.deepEqual(await store.getRepo(created.id), created);
  assert.equal((await store.listRepos()).length, 4);
  assert.equal(await store.setRepoAutoMerge(created.id, true), true);
  await dataSource.destroy();

  dataSource = createAppDataSource(dataDir);
  await dataSource.initialize();
  store = new DatabaseDataStore(dataSource);
  await store.initialize();

  assert.equal((await store.getRepo(created.id))?.autoMerge, true);
  assert.equal(await store.deleteRepo(created.id), "deleted");
  await dataSource.destroy();

  dataSource = createAppDataSource(dataDir);
  await dataSource.initialize();
  store = new DatabaseDataStore(dataSource);
  await store.initialize();

  assert.equal(await store.getRepo(created.id), undefined);
  assert.equal((await store.listRepos()).length, 3);
});

void test("persists trajectories, turns, and ordered events across restarts", async (t) => {
  const dataDir = await mkdtemp(
    path.join(os.tmpdir(), "llm-garage-trajectories-"),
  );
  let dataSource = createAppDataSource(dataDir);
  t.after(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
    await rm(dataDir, { recursive: true, force: true });
  });
  await dataSource.initialize();
  const store = new DatabaseDataStore(dataSource, {
    seed: false,
    simulationStepMs: 5,
  });
  await store.initialize();

  const repo = await store.createRepo({
    owner: "example",
    name: "trajectory-project",
    defaultBranch: "main",
    autoMerge: false,
  });
  await assert.rejects(
    store.createRepo({
      owner: repo.owner,
      name: repo.name,
      defaultBranch: "different",
      autoMerge: false,
    }),
    RepoAlreadyExistsError,
  );

  const trajectory = await createOne(store, {
    repoId: repo.id,
    title: "Persist the trajectory",
    modelIds: ["openai/gpt-5.6-sol"],
    taskPrompt: "Exercise the database store",
  });
  const [runningTurn] = await store.listTurns(trajectory.id);
  assert.ok(runningTurn);
  assert.equal((await store.listRunEvents(runningTurn.id)).length, 1);
  await waitForStatus(store, trajectory.id, "succeeded");

  const [initialTurn] = await store.listTurns(trajectory.id);
  assert.equal((await store.getTrajectory(trajectory.id))?.status, "succeeded");
  assert.equal(initialTurn?.status, "succeeded");
  assert.ok(initialTurn);
  const initialEvents = await store.listRunEvents(initialTurn.id);
  assertOrdered(initialEvents.map(({ sequence }) => sequence));

  const feedbackTurn = await store.addFeedback(
    trajectory.id,
    "Tighten the copy",
  );
  await waitForStatus(store, trajectory.id, "succeeded");
  const feedbackEvents = await store.listRunEvents(feedbackTurn.id);
  assertOrdered(feedbackEvents.map(({ sequence }) => sequence));
  assert.ok(
    (feedbackEvents[0]?.sequence ?? 0) > (initialEvents.at(-1)?.sequence ?? 0),
  );

  await dataSource.destroy();
  dataSource = createAppDataSource(dataDir);
  await dataSource.initialize();
  const restartedStore = new DatabaseDataStore(dataSource, { seed: false });
  await restartedStore.initialize();

  assert.equal(
    (await restartedStore.getTrajectory(trajectory.id))?.status,
    "succeeded",
  );
  assert.equal((await restartedStore.listTurns(trajectory.id)).length, 2);
  assert.deepEqual(
    await restartedStore.listRunEvents(initialTurn.id),
    initialEvents,
  );
  assert.deepEqual(
    await restartedStore.listRunEvents(feedbackTurn.id),
    feedbackEvents,
  );
  assert.equal(await restartedStore.deleteRepo(repo.id), "in_use");
});

void test("commits cancellation state and its event together", async (t) => {
  const dataDir = await mkdtemp(
    path.join(os.tmpdir(), "llm-garage-trajectory-cancel-"),
  );
  const dataSource = createAppDataSource(dataDir);
  t.after(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
    await rm(dataDir, { recursive: true, force: true });
  });
  await dataSource.initialize();
  const store = new DatabaseDataStore(dataSource, {
    seed: false,
    simulationStepMs: 100,
  });
  await store.initialize();

  const repo = await store.createRepo({
    owner: "example",
    name: "cancel-project",
    defaultBranch: "main",
    autoMerge: false,
  });
  const trajectory = await createOne(store, {
    repoId: repo.id,
    title: "Cancel the trajectory",
    modelIds: ["openai/gpt-5.6-sol"],
    taskPrompt: "Wait for cancellation",
  });

  assert.equal(await store.cancelTrajectory(trajectory.id), true);
  const [turn] = await store.listTurns(trajectory.id);
  assert.equal((await store.getTrajectory(trajectory.id))?.status, "cancelled");
  assert.equal(turn?.status, "cancelled");
  assert.ok(turn);
  assert.deepEqual(
    (await store.listRunEvents(turn.id)).map(({ data }) => data),
    ["GPT-5.6 Sol started", "Trajectory cancelled by user"],
  );
});

void test("sends persisted conversation history to each worker turn", async (t) => {
  const dataDir = await mkdtemp(
    path.join(os.tmpdir(), "llm-garage-conversation-"),
  );
  const dataSource = createAppDataSource(dataDir);
  t.after(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
    await rm(dataDir, { recursive: true, force: true });
  });
  await dataSource.initialize();
  const conversations: ConversationMessage[][] = [];
  const store = new DatabaseDataStore(dataSource, {
    seed: false,
    worker: {
      run: async (context) => {
        conversations.push(context.messages.map((message) => ({ ...message })));
        context.emit({
          kind: "model_output",
          data: conversations.length === 1 ? "First answer" : "Second answer",
        });
      },
    },
  });
  const repo = await store.createRepo({
    owner: "example",
    name: "conversation-project",
    defaultBranch: "main",
    autoMerge: false,
  });
  const trajectory = await createOne(store, {
    repoId: repo.id,
    title: "Have a conversation",
    modelIds: ["anthropic/claude-opus-5"],
    taskPrompt: "First question",
  });
  await waitForStatus(store, trajectory.id, "succeeded");

  await store.addFeedback(trajectory.id, "Follow-up question");
  await waitForStatus(store, trajectory.id, "succeeded");

  assert.deepEqual(conversations, [
    [{ role: "user", content: "First question" }],
    [
      { role: "user", content: "First question" },
      { role: "assistant", content: "First answer" },
      { role: "user", content: "Follow-up question" },
    ],
  ]);
});

void test("runs one trajectory per selected model in a comparison", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "llm-garage-compare-"));
  const dataSource = createAppDataSource(dataDir);
  t.after(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
    await rm(dataDir, { recursive: true, force: true });
  });
  await dataSource.initialize();
  const store = new DatabaseDataStore(dataSource, {
    seed: false,
    worker: {
      run: async (context) => {
        context.emit({
          kind: "model_output",
          data: `${context.modelName} answered`,
        });
      },
    },
  });
  await store.initialize();

  const repo = await store.createRepo({
    owner: "example",
    name: "compare-project",
    defaultBranch: "main",
    autoMerge: false,
  });
  const modelIds = [
    "openai/gpt-5.6-sol",
    "anthropic/claude-opus-5",
  ] satisfies Trajectory["modelId"][];
  const trajectories = await store.createTrajectories({
    repoId: repo.id,
    title: "Compare the models",
    modelIds,
    taskPrompt: "Answer the same question",
  });

  assert.deepEqual(
    trajectories.map(({ modelId }) => modelId),
    modelIds,
  );
  const comparisonId = trajectories[0]?.comparisonId;
  assert.ok(comparisonId);
  assert.ok(
    trajectories.every(
      (trajectory) => trajectory.comparisonId === comparisonId,
    ),
  );
  for (const trajectory of trajectories)
    await waitForStatus(store, trajectory.id, "succeeded");

  const comparison = await store.listComparison(comparisonId);
  assert.deepEqual(
    comparison.map(({ id }) => id),
    trajectories.map(({ id }) => id),
  );
  const outputs = await Promise.all(
    comparison.map(async (trajectory) => {
      const [turn] = await store.listTurns(trajectory.id);
      assert.ok(turn);
      return (await store.listRunEvents(turn.id))
        .filter((event) => event.kind === "model_output")
        .map((event) => event.data);
    }),
  );
  assert.deepEqual(outputs, [
    ["GPT-5.6 Sol answered"],
    ["Claude Opus 5 answered"],
  ]);
});

void test("leaves a single-model trajectory out of any comparison", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "llm-garage-single-"));
  const dataSource = createAppDataSource(dataDir);
  t.after(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
    await rm(dataDir, { recursive: true, force: true });
  });
  await dataSource.initialize();
  const store = new DatabaseDataStore(dataSource, {
    seed: false,
    worker: { run: async () => undefined },
  });
  await store.initialize();

  const repo = await store.createRepo({
    owner: "example",
    name: "single-project",
    defaultBranch: "main",
    autoMerge: false,
  });
  const trajectory = await createOne(store, {
    repoId: repo.id,
    title: "Just one model",
    modelIds: ["openai/gpt-5.6-sol"],
    taskPrompt: "Answer once",
  });

  assert.equal(trajectory.comparisonId, undefined);
  await assert.rejects(
    store.createTrajectories({
      repoId: repo.id,
      title: "No models",
      modelIds: [],
      taskPrompt: "Nothing to run",
    }),
    /No models selected/,
  );
});

void test("rejects invalid trajectory relationships without partial records", async (t) => {
  const dataDir = await mkdtemp(
    path.join(os.tmpdir(), "llm-garage-trajectory-relations-"),
  );
  const dataSource = createAppDataSource(dataDir);
  t.after(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
    await rm(dataDir, { recursive: true, force: true });
  });
  await dataSource.initialize();
  const store = new DatabaseDataStore(dataSource, {
    seed: false,
    worker: { run: async () => undefined },
  });
  await store.initialize();

  await assert.rejects(
    createOne(store, {
      repoId: "missing",
      title: "Invalid",
      modelIds: ["openai/gpt-5.6-sol"],
      taskPrompt: "Do not persist this",
    }),
    /Repository not found/,
  );
  assert.deepEqual(await store.listTrajectories(), []);

  const firstRepo = await store.createRepo({
    owner: "example",
    name: "first-project",
    defaultBranch: "main",
    autoMerge: false,
  });
  const secondRepo = await store.createRepo({
    owner: "example",
    name: "second-project",
    defaultBranch: "main",
    autoMerge: false,
  });
  const parent = await createOne(store, {
    repoId: firstRepo.id,
    title: "Parent",
    modelIds: ["openai/gpt-5.6-sol"],
    taskPrompt: "Create the parent",
  });
  await waitForStatus(store, parent.id, "succeeded");

  await assert.rejects(
    createOne(store, {
      repoId: secondRepo.id,
      parentId: parent.id,
      title: "Invalid child",
      modelIds: ["openai/gpt-5.6-sol"],
      taskPrompt: "Cross repository boundaries",
    }),
    /different repository/,
  );
  assert.deepEqual(
    (await store.listTrajectories()).map(({ id }) => id),
    [parent.id],
  );
});

void test("persists worker failures and their terminal events", async (t) => {
  const dataDir = await mkdtemp(
    path.join(os.tmpdir(), "llm-garage-trajectory-failure-"),
  );
  const dataSource = createAppDataSource(dataDir);
  t.after(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
    await rm(dataDir, { recursive: true, force: true });
  });
  await dataSource.initialize();
  const store = new DatabaseDataStore(dataSource, {
    seed: false,
    worker: {
      run: async () => {
        throw new Error("scripted failure");
      },
    },
  });
  const repo = await store.createRepo({
    owner: "example",
    name: "failure-project",
    defaultBranch: "main",
    autoMerge: false,
  });
  const trajectory = await createOne(store, {
    repoId: repo.id,
    title: "Fail the trajectory",
    modelIds: ["openai/gpt-5.6-sol"],
    taskPrompt: "Exercise failure storage",
  });

  await waitForStatus(store, trajectory.id, "failed");
  const [turn] = await store.listTurns(trajectory.id);
  assert.equal(turn?.status, "failed");
  assert.ok(turn);
  assert.deepEqual(
    (await store.listRunEvents(turn.id)).map(({ kind, sequence }) => ({
      kind,
      sequence,
    })),
    [
      { kind: "status", sequence: 1 },
      { kind: "system", sequence: 2 },
      { kind: "status", sequence: 3 },
    ],
  );
});

void test("owns a sandbox for the full trajectory lifecycle", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "llm-garage-sandbox-"));
  const dataSource = createAppDataSource(dataDir);
  t.after(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
    await rm(dataDir, { recursive: true, force: true });
  });
  await dataSource.initialize();
  const created: string[] = [];
  const archived: string[] = [];
  const commands: Array<{ trajectoryId: string; command: string }> = [];
  const sandbox: Sandbox = {
    create: async (trajectoryId) => {
      created.push(trajectoryId);
    },
    runCommand: async (trajectoryId, command) => {
      commands.push({ trajectoryId, command });
      return {
        exitCode: 0,
        stdout: "bin\nworkspace\n",
        stderr: "",
        truncated: false,
      };
    },
    archive: async (trajectoryId) => {
      archived.push(trajectoryId);
    },
  };
  const store = new DatabaseDataStore(dataSource, {
    seed: false,
    sandbox,
    worker: {
      run: async (context) => {
        assert.ok(context.runCommand);
        const result = await context.runCommand("ls /");
        context.emit({ kind: "tool", data: result.stdout });
      },
    },
  });
  const repo = await store.createRepo({
    owner: "example",
    name: "sandbox-project",
    defaultBranch: "main",
    autoMerge: false,
  });
  const trajectory = await createOne(store, {
    repoId: repo.id,
    title: "Use a sandbox",
    modelIds: ["openai/gpt-5.6-sol"],
    taskPrompt: "List the root directory",
  });

  await waitForStatus(store, trajectory.id, "succeeded");
  assert.deepEqual(created, [trajectory.id]);
  assert.deepEqual(commands, [
    { trajectoryId: trajectory.id, command: "ls /" },
  ]);
  assert.equal(await store.archiveTrajectory(trajectory.id), true);
  assert.deepEqual(archived, [trajectory.id]);
});

void test("aggregates recorded usage into a spend report", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "llm-garage-spend-"));
  const dataSource = createAppDataSource(dataDir);
  t.after(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
    await rm(dataDir, { recursive: true, force: true });
  });
  await dataSource.initialize();
  const priced: TokenUsage = {
    inputTokens: 100,
    outputTokens: 10,
    costUsd: 0.25,
  };
  const unpriced: TokenUsage = { inputTokens: 200, outputTokens: 20 };
  const store = new DatabaseDataStore(dataSource, {
    seed: false,
    worker: {
      run: async (context) => {
        const usage =
          context.modelId === "openai/gpt-5.6-sol" ? priced : unpriced;
        context.emit({ kind: "usage", data: formatUsage(usage), usage });
        context.emit({ kind: "model_output", data: "Done" });
      },
    },
  });
  await store.initialize();

  const repo = await store.createRepo({
    owner: "example",
    name: "spend-project",
    defaultBranch: "main",
    autoMerge: false,
  });
  const trajectories = await store.createTrajectories({
    repoId: repo.id,
    title: "Spend on both models",
    modelIds: ["openai/gpt-5.6-sol", "anthropic/claude-opus-5"],
    taskPrompt: "Answer the same question",
  });
  for (const trajectory of trajectories)
    await waitForStatus(store, trajectory.id, "succeeded");

  const [pricedTrajectory] = trajectories;
  assert.ok(pricedTrajectory);
  const [pricedTurn] = await store.listTurns(pricedTrajectory.id);
  assert.deepEqual(pricedTurn?.usage, priced);

  const spend = await store.getSpend();
  assert.equal(spend.trajectories, 2);
  assert.deepEqual(spend.usage, {
    inputTokens: 300,
    outputTokens: 30,
    costUsd: 0.25,
  });
  assert.equal(spend.unpricedTurns, 1);
  assert.deepEqual(spend.byModel, [
    {
      id: "openai/gpt-5.6-sol",
      label: "GPT-5.6 Sol",
      trajectories: 1,
      usage: priced,
    },
    {
      id: "anthropic/claude-opus-5",
      label: "Claude Opus 5",
      trajectories: 1,
      usage: unpriced,
    },
  ]);
  assert.deepEqual(spend.byRepo, [
    {
      id: repo.id,
      label: "example/spend-project",
      trajectories: 2,
      usage: { inputTokens: 300, outputTokens: 30, costUsd: 0.25 },
    },
  ]);
});

async function waitForStatus(
  store: DataStore,
  trajectoryId: string,
  expected: TrajectoryStatus,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await store.getTrajectory(trajectoryId))?.status === expected) return;
    await delay(10);
  }
  assert.fail(`Trajectory ${trajectoryId} did not reach ${expected}`);
}

function assertOrdered(sequence: number[]): void {
  assert.ok(sequence.length > 1);
  assert.equal(new Set(sequence).size, sequence.length);
  assert.deepEqual(
    sequence,
    [...sequence].sort((left, right) => left - right),
  );
}

async function createOne(
  store: DataStore,
  input: CreateTrajectoriesInput,
): Promise<Trajectory> {
  const [trajectory] = await store.createTrajectories(input);
  assert.ok(trajectory);
  return trajectory;
}
