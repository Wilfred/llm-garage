import { uptime as machineUptime } from "node:os";
import { Router } from "express";
import { loadBuildInfo } from "../../build-info";
import type { DataStore } from "../../store/types";
import { AboutPage } from "../../views/pages/about";
import { DashboardPage } from "../../views/pages/dashboard";
import { renderPage } from "../../views/render";

export function createPagesRouter(store: DataStore): Router {
  const router = Router();
  const buildInfo = loadBuildInfo();

  router.get("/", async (_req, res) => {
    const [repos, sessions] = await Promise.all([
      store.listRepos(),
      store.listSessions(),
    ]);
    res
      .type("html")
      .send(renderPage(<DashboardPage repos={repos} sessions={sessions} />));
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
