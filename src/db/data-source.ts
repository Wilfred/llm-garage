import "reflect-metadata";
import path from "node:path";
import { DataSource } from "typeorm";
import { RepoEntity } from "../entities/repo";
import { RunEventEntity } from "../entities/run-event";
import { TrajectoryEntity } from "../entities/trajectory";
import { Setting } from "../entities/setting";
import { TurnEntity } from "../entities/turn";

export const databaseFilename = "app.db";

export function createAppDataSource(dataDir: string): DataSource {
  return new DataSource({
    type: "better-sqlite3",
    database: path.join(dataDir, databaseFilename),
    entities: [
      Setting,
      RepoEntity,
      TrajectoryEntity,
      TurnEntity,
      RunEventEntity,
    ],
    synchronize: true,
    enableWAL: true,
    timeout: 5_000,
  });
}
