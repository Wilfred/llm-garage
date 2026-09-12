import { Router } from "express";
import {
  DisabledContainerManager,
  type ContainerManager,
} from "../../sandbox/types";
import type { DataStore, Trajectory } from "../../store/types";
import { ContainersPage } from "../../views/pages/containers";
import { renderPage } from "../../views/render";
import { noticeUrl, queryString } from "./forms";

export function createContainersRouter(
  store: DataStore,
  containers: ContainerManager = new DisabledContainerManager(),
): Router {
  const router = Router();

  router.get("/containers", async (req, res) => {
    const [managedContainers, trajectories] = await Promise.all([
      containers.listContainers(),
      store.listTrajectories(),
    ]);
    const notice = queryString(req.query["notice"]);
    res
      .type("html")
      .send(
        renderPage(
          <ContainersPage
            containers={managedContainers}
            trajectories={trajectories}
            {...(notice === undefined ? {} : { notice })}
          />,
        ),
      );
  });

  router.post("/containers/remove-idle", async (_req, res) => {
    const trajectories = await store.listTrajectories();
    const count = await containers.removeContainers({
      keepTrajectoryIds: activeTrajectoryIds(trajectories),
    });
    res.redirect(303, noticeUrl("/containers", removalNotice(count, true)));
  });

  router.post("/containers/remove-all", async (_req, res) => {
    const count = await containers.removeContainers();
    res.redirect(303, noticeUrl("/containers", removalNotice(count, false)));
  });

  return router;
}

export function activeTrajectoryIds(
  trajectories: Trajectory[],
): ReadonlySet<string> {
  return new Set(
    trajectories
      .filter(({ status }) => status === "running" || status === "queued")
      .map(({ id }) => id),
  );
}

function removalNotice(count: number, idle: boolean): string {
  const noun = count === 1 ? "container" : "containers";
  return `Removed ${count.toString()} ${idle ? "idle " : ""}${noun}.`;
}
