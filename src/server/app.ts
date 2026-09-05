import express, { type Express } from "express";
import type { DataSource } from "typeorm";
import { createHealthRouter } from "./routes/health";
import { pagesRouter } from "./routes/pages";

export function createApp(dataSource: DataSource): Express {
  const app = express();

  app.use(pagesRouter);
  app.use(createHealthRouter(dataSource));

  return app;
}
