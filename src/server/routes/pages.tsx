import { uptime as machineUptime } from "node:os";
import { Router } from "express";
import { loadBuildInfo } from "../../build-info";
import type { DataStore } from "../../store/types";
import { AboutPage } from "../../views/pages/about";
import { DashboardPage } from "../../views/pages/dashboard";
import { SpendPage } from "../../views/pages/spend";
import { renderPage } from "../../views/render";

export function createPagesRouter(store: DataStore): Router {
  const router = Router();
  const buildInfo = loadBuildInfo();

  router.get("/", async (_req, res) => {
    const [repos, trajectories, models] = await Promise.all([
      store.listRepos(),
      store.listTrajectories(),
      store.listModels(),
    ]);
    res
      .type("html")
      .send(
        renderPage(
          <DashboardPage
            repos={repos}
            trajectories={trajectories}
            models={models}
          />,
        ),
      );
  });

  router.get("/spend", async (_req, res) => {
    const spend = await store.getSpend();
    res.type("html").send(renderPage(<SpendPage spend={spend} />));
  });

  router.get("/about", (_req, res) => {
    res
      .type("html")
      .send(
        renderPage(
          <AboutPage
            {...buildInfo}
            processUptimeSeconds={process.uptime()}
            machineUptimeSeconds={machineUptime()}
          />,
        ),
      );
  });

  return router;
}
