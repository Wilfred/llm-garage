import path from "node:path";
import express, { type Express } from "express";
import { h } from "preact";
import type { DataSource } from "typeorm";
import {
  DisabledContainerManager,
  type ContainerManager,
} from "../sandbox/types";
import type { DataStore } from "../store/types";
import { NotFoundPage } from "../views/pages/trajectories";
import { renderPage } from "../views/render";
import { createAuth, type AuthOptions } from "./auth";
import { createHealthRouter } from "./routes/health";
import { createContainersRouter } from "./routes/containers";
import { createModelsRouter } from "./routes/models";
import { createPagesRouter, createPublicPagesRouter } from "./routes/pages";
import { createReposRouter } from "./routes/repos";
import { createTrajectoriesRouter } from "./routes/trajectories";

export function createApp(
  dataSource: DataSource,
  store: DataStore,
  containers: ContainerManager = new DisabledContainerManager(),
  auth?: AuthOptions,
): Express {
  const app = express();

  // Trust X-Forwarded-* from proxies on this machine or a private network.
  app.set("trust proxy", "loopback, uniquelocal");
  app.use(express.static(path.resolve(__dirname, "../../public")));
  app.use(express.urlencoded({ extended: false }));

  // Routes before requireSignIn are public.
  const signIn = auth && createAuth(auth);
  if (signIn) {
    app.use(signIn.router);
  }
  app.use(createPublicPagesRouter(store));
  app.use(createHealthRouter(dataSource));
  if (signIn) {
    app.use(signIn.requireSignIn);
  }

  app.use(createPagesRouter(store));
  app.use(createContainersRouter(store, containers));
  app.use(createModelsRouter(store));
  app.use(createReposRouter(store));
  app.use(createTrajectoriesRouter(store));
  app.use((_req, res) => {
    res
      .status(404)
      .type("html")
      .send(renderPage(h(NotFoundPage, null)));
  });

  return app;
}
