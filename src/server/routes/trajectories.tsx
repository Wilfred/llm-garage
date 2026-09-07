import { Router } from "express";
import type { DataStore, Repo, Trajectory } from "../../store/types";
import {
  NewTrajectoryPage,
  NotFoundPage,
  TrajectoryDetailPage,
  TrajectoriesPage,
  type TurnTranscript,
} from "../../views/pages/trajectories";
import { ComparisonPage } from "../../views/pages/comparisons";
import { renderPage } from "../../views/render";
import { formField, formFields, queryString } from "./forms";

export function createTrajectoriesRouter(store: DataStore): Router {
  const router = Router();

  router.get("/trajectories", async (req, res) => {
    const [repos, trajectories, models] = await Promise.all([
      store.listRepos(),
      store.listTrajectories(),
      store.listModels(),
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
            models={models}
            {...(selectedRepo === undefined ? {} : { selectedRepo })}
          />,
        ),
      );
  });

  router.get("/trajectories/new", async (req, res) => {
    const [repos, models] = await Promise.all([
      store.listRepos(),
      store.listModels(),
    ]);
    const selectedRepoId = queryString(req.query["repoId"]);
    res
      .type("html")
      .send(
        renderPage(
          <NewTrajectoryPage
            repos={repos}
            models={models}
            {...(selectedRepoId === undefined ? {} : { selectedRepoId })}
          />,
        ),
      );
  });

  router.post("/trajectories", async (req, res) => {
    const repoId = formField(req.body, "repoId");
    const taskPrompt = formField(req.body, "taskPrompt");
    const modelIds = formFields(req.body, "modelIds");
    const models = await store.listModels();
    if (
      !repoId ||
      !taskPrompt ||
      modelIds.length === 0 ||
      !modelIds.every((modelId) => models.some(({ id }) => id === modelId))
    ) {
      const repos = await store.listRepos();
      res
        .status(400)
        .type("html")
        .send(
          renderPage(
            <NewTrajectoryPage
              repos={repos}
              models={models}
              selectedRepoId={repoId}
              selectedModelIds={modelIds}
              error="Repository, at least one model, and task are required."
            />,
          ),
        );
      return;
    }
    const [trajectory] = await store.createTrajectories({
      repoId,
      title: titleFromTask(taskPrompt),
      taskPrompt,
      modelIds,
    });
    if (!trajectory) throw new Error("No trajectory was started");
    res.redirect(
      303,
      trajectory.comparisonId
        ? `/comparisons/${trajectory.comparisonId}`
        : `/trajectories/${trajectory.id}`,
    );
  });

  router.get("/comparisons/:id", async (req, res) => {
    const trajectories = await store.listComparison(req.params.id);
    const first = trajectories[0];
    if (!first) {
      res
        .status(404)
        .type("html")
        .send(
          renderPage(
            <NotFoundPage message="That comparison does not exist." />,
          ),
        );
      return;
    }
    const [repo, models, columns] = await Promise.all([
      store.getRepo(first.repoId),
      store.listModels(),
      Promise.all(
        trajectories.map(async (trajectory) => ({
          trajectory,
          transcript: await loadTranscript(store, trajectory.id),
        })),
      ),
    ]);
    res
      .type("html")
      .send(
        renderPage(
          <ComparisonPage
            columns={columns}
            models={models}
            {...(repo === undefined ? {} : { repo })}
          />,
        ),
      );
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
    const transcript = await loadTranscript(store, trajectory.id);
    res
      .type("html")
      .send(
        renderPage(
          <TrajectoryDetailPage
            trajectory={trajectory}
            transcript={transcript}
          />,
        ),
      );
  });

  router.post("/trajectories/:id/prompts", async (req, res) => {
    const prompt = formField(req.body, "prompt");
    if (prompt) await store.addFeedback(req.params.id, prompt);
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

async function loadTranscript(
  store: DataStore,
  trajectoryId: string,
): Promise<TurnTranscript[]> {
  const turns = await store.listTurns(trajectoryId);
  return Promise.all(
    turns.map(async (turn) => ({
      turn,
      events: await store.listRunEvents(turn.id),
    })),
  );
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
