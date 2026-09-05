import path from "node:path";
import express, { type Express } from "express";
import { h } from "preact";
import type { DataSource } from "typeorm";
import type { DataStore } from "../store/types";
import { NotFoundPage } from "../views/pages/sessions";
import { renderPage } from "../views/render";
import { createHealthRouter } from "./routes/health";
import { createPagesRouter } from "./routes/pages";
import { createReposRouter } from "./routes/repos";
import { createSessionsRouter } from "./routes/sessions";

export function createApp(dataSource: DataSource, store: DataStore): Express {
  const app = express();

  app.use(express.static(path.resolve(__dirname, "../../public")));
  app.use(express.urlencoded({ extended: false }));
  app.use(createPagesRouter(store));
  app.use(createReposRouter(store));
  app.use(createSessionsRouter(store));
  app.use(createHealthRouter(dataSource));
  app.use((_req, res) => {
    res
      .status(404)
      .type("html")
      .send(renderPage(h(NotFoundPage, null)));
  });

  return app;
}
