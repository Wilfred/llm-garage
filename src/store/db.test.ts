import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { DataSource } from "typeorm";
import { createAppDataSource } from "../db/data-source";
import { RepoAlreadyExistsError } from "./errors";
import { DatabaseDataStore } from "./db";

test("persists repository CRUD across data source restarts", async (t) => {
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
  });
  await dataSource.destroy();

  dataSource = createAppDataSource(dataDir);
  await dataSource.initialize();
  store = new DatabaseDataStore(dataSource);
  await store.initialize();

  assert.deepEqual(await store.getRepo(created.id), created);
  assert.equal((await store.listRepos()).length, 4);
  assert.equal(await store.deleteRepo(created.id), "deleted");
  await dataSource.destroy();

  dataSource = createAppDataSource(dataDir);
  await dataSource.initialize();
  store = new DatabaseDataStore(dataSource);
  await store.initialize();

  assert.equal(await store.getRepo(created.id), undefined);
  assert.equal((await store.listRepos()).length, 3);
});

test("keeps the persistent repo slice coherent with prototype sessions", async (t) => {
  const dataDir = await mkdtemp(
    path.join(os.tmpdir(), "llm-garage-repo-seam-"),
  );
  const dataSource = createAppDataSource(dataDir);
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
    name: "session-project",
    defaultBranch: "main",
  });
  await assert.rejects(
    store.createRepo({
      owner: repo.owner,
      name: repo.name,
      defaultBranch: "different",
    }),
    RepoAlreadyExistsError,
  );

  await store.createSession({
    repoId: repo.id,
    title: "Use a persisted repository",
    modelId: "openai/gpt-5.6-sol",
    taskPrompt: "Exercise the hybrid store",
    createPr: false,
    autoMerge: false,
  });
  assert.equal(await store.deleteRepo(repo.id), "in_use");
});
