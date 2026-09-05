import { uptime as machineUptime } from "node:os";
import { Router } from "express";
import { loadBuildInfo } from "../../build-info";
import { AboutPage } from "../../views/pages/about";
import { HomePage } from "../../views/pages/home";
import { renderPage } from "../../views/render";

export const pagesRouter = Router();
const buildInfo = loadBuildInfo();

pagesRouter.get("/", (_req, res) => {
  res.type("html").send(renderPage(<HomePage />));
});

pagesRouter.get("/about", (_req, res) => {
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
