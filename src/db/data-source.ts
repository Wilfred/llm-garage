import "reflect-metadata";
import path from "node:path";
import { DataSource } from "typeorm";
import { Setting } from "../entities/setting";

export const databaseFilename = "app.db";

export function createAppDataSource(dataDir: string): DataSource {
  return new DataSource({
    type: "better-sqlite3",
    database: path.join(dataDir, databaseFilename),
    entities: [Setting],
    synchronize: true,
    enableWAL: true,
    timeout: 5_000,
  });
}
