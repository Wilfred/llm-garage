import { Router } from "express";
import { isModelId } from "../../models";
import type { DataStore, Repo, Trajectory } from "../../store/types";
import {
  NewTrajectoryPage,
  NotFoundPage,
  TrajectoryDetailPage,
  TrajectoriesPage,
  type TurnTranscript,
} from "../../views/pages/trajectories";
import { renderPage } from "../../views/render";
import { formField, queryString } from "./forms";

export function createTrajectoriesRouter(store: DataStore): Router {
  const router = Router();

  router.get("/trajectories", async (req, res) => {
    const [repos, trajectories] = await Promise.all([
      store.listRepos(),
      store.listTrajectories(),
    ]);
    const repoId = queryString(req.query["repoId"]);
    const { selectedRepo, visibleTrajectories } = filterTrajectoriesByRepo(
      repos,
      trajectories,
      repoId,
    );
    res
      .type("html")
      .send(
        renderPage(
          <TrajectoriesPage
            repos={repos}
            trajectories={visibleTrajectories}
            {...(selectedRepo === undefined ? {} : { selectedRepo })}
          />,
        ),
      );
  });

  router.get("/trajectories/new", async (req, res) => {
    const repos = await store.listRepos();
    const selectedRepoId = queryString(req.query["repoId"]);
    res
      .type("html")
      .send(
        renderPage(
          <NewTrajectoryPage
            repos={repos}
            {...(selectedRepoId === undefined ? {} : { selectedRepoId })}
          />,
        ),
      );
  });

  router.post("/trajectories", async (req, res) => {
    const repoId = formField(req.body, "repoId");
    const taskPrompt = formField(req.body, "taskPrompt");
    const modelId = formField(req.body, "modelId");
    if (!repoId || !taskPrompt || !isModelId(modelId)) {
      const repos = await store.listRepos();
      res
        .status(400)
        .type("html")
        .send(
          renderPage(
            <NewTrajectoryPage
              repos={repos}
              selectedRepoId={repoId}
              error="Repository, model, and task are required."
            />,
          ),
        );
      return;
    }
    const trajectory = await store.createTrajectory({
      repoId,
      title: titleFromTask(taskPrompt),
      taskPrompt,
      modelId,
      createPr: true,
      autoMerge: false,
    });
    res.redirect(303, `/trajectories/${trajectory.id}`);
  });

  router.get("/trajectories/:id", async (req, res) => {
    const trajectory = await store.getTrajectory(req.params.id);
    if (!trajectory) {
      res
        .status(404)
        .type("html")
        .send(
          renderPage(
            <NotFoundPage message="That trajectory does not exist." />,
          ),
        );
      return;
    }
    const [repo, turns] = await Promise.all([
      store.getRepo(trajectory.repoId),
      store.listTurns(trajectory.id),
    ]);
    const transcript: TurnTranscript[] = await Promise.all(
      turns.map(async (turn) => ({
        turn,
        events: await store.listRunEvents(turn.id),
      })),
    );
    res
      .type("html")
      .send(
        renderPage(
          <TrajectoryDetailPage
            trajectory={trajectory}
            {...(repo === undefined ? {} : { repo })}
            transcript={transcript}
          />,
        ),
      );
  });

  router.post("/trajectories/:id/feedback", async (req, res) => {
    const feedback = formField(req.body, "feedback");
    if (feedback) await store.addFeedback(req.params.id, feedback);
    res.redirect(303, `/trajectories/${req.params.id}`);
  });

  router.post("/trajectories/:id/cancel", async (req, res) => {
    await store.cancelTrajectory(req.params.id);
    res.redirect(303, `/trajectories/${req.params.id}`);
  });

  router.post("/trajectories/:id/archive", async (req, res) => {
    await store.archiveTrajectory(req.params.id);
    res.redirect(303, `/trajectories/${req.params.id}`);
  });

  return router;
}

export function titleFromTask(taskPrompt: string): string {
  const firstLine = taskPrompt.split(/\r?\n/, 1)[0] ?? taskPrompt;
  return firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine;
}

export function filterTrajectoriesByRepo(
  repos: Repo[],
  trajectories: Trajectory[],
  repoId?: string,
): { selectedRepo?: Repo; visibleTrajectories: Trajectory[] } {
  const selectedRepo = repoId
    ? repos.find((candidate) => candidate.id === repoId)
    : undefined;
  return {
    ...(selectedRepo === undefined ? {} : { selectedRepo }),
    visibleTrajectories: selectedRepo
      ? trajectories.filter(
          (trajectory) => trajectory.repoId === selectedRepo.id,
        )
      : trajectories,
  };
}
