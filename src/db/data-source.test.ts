import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { DataSource } from "typeorm";
import { createAppDataSource, databaseFilename } from "./data-source";
import { Setting } from "../entities/setting";

test("creates a WAL database and persists settings across restarts", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "llm-garage-db-"));
  let dataSource: DataSource | undefined;

  t.after(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
    await rm(dataDir, { recursive: true, force: true });
  });

  dataSource = createAppDataSource(dataDir);
  await dataSource.initialize();

  const journalMode = (await dataSource.query("PRAGMA journal_mode")) as Array<{
    journal_mode: string;
  }>;
  assert.equal(journalMode[0]?.journal_mode, "wal");

  await dataSource.getRepository(Setting).save({
    key: "basePromptId",
    value: "prompt-1",
  });
  await stat(path.join(dataDir, databaseFilename));
  await dataSource.destroy();

  dataSource = createAppDataSource(dataDir);
  await dataSource.initialize();

  const setting = await dataSource
    .getRepository(Setting)
    .findOneByOrFail({ key: "basePromptId" });
  assert.equal(setting.value, "prompt-1");
});
