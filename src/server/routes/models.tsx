import { Router } from "express";
import { isModelEffort } from "../../models";
import { ModelAlreadyExistsError } from "../../store/errors";
import type { DataStore } from "../../store/types";
import {
  ModelDetailPage,
  ModelsPage,
  NewModelPage,
} from "../../views/pages/models";
import { NotFoundPage } from "../../views/pages/trajectories";
import { renderPage } from "../../views/render";
import { formField, noticeUrl, queryString } from "./forms";

export function createModelsRouter(store: DataStore): Router {
  const router = Router();

  router.get("/models", async (req, res) => {
    const [models, trajectories] = await Promise.all([
      store.listModels(),
      store.listTrajectories(),
    ]);
    const notice = queryString(req.query["notice"]);
    res
      .type("html")
      .send(
        renderPage(
          <ModelsPage
            models={models}
            trajectories={trajectories}
            {...(notice === undefined ? {} : { notice })}
          />,
        ),
      );
  });

  router.get("/models/new", (_req, res) => {
    res.type("html").send(renderPage(<NewModelPage />));
  });

  router.post("/models", async (req, res) => {
    const id = formField(req.body, "id");
    const name = formField(req.body, "name");
    const provider = formField(req.body, "provider");
    const effort = formField(req.body, "effort");
    if (!id || !name || !provider || !isModelEffort(effort)) {
      res
        .status(400)
        .type("html")
        .send(
          renderPage(
            <NewModelPage
              values={{ id, name, provider, effort }}
              error="Model id, name, provider, and effort are required."
            />,
          ),
        );
      return;
    }
    try {
      await store.createModel({ id, name, provider, effort });
    } catch (error) {
      if (!(error instanceof ModelAlreadyExistsError)) throw error;
      res
        .status(409)
        .type("html")
        .send(
          renderPage(
            <NewModelPage
              values={{ id, name, provider, effort }}
              error={error.message}
            />,
          ),
        );
      return;
    }
    res.redirect(303, noticeUrl("/models", `Added ${name}.`));
  });

  router.get("/models/:id", async (req, res) => {
    const [model, trajectories] = await Promise.all([
      store.getModel(req.params.id),
      store.listTrajectories(),
    ]);
    if (!model) {
      res
        .status(404)
        .type("html")
        .send(
          renderPage(<NotFoundPage message="That model does not exist." />),
        );
      return;
    }
    const notice = queryString(req.query["notice"]);
    res
      .type("html")
      .send(
        renderPage(
          <ModelDetailPage
            model={model}
            trajectories={trajectories.filter(
              (trajectory) => trajectory.modelId === model.id,
            )}
            {...(notice === undefined ? {} : { notice })}
          />,
        ),
      );
  });

  router.post("/models/:id", async (req, res) => {
    const name = formField(req.body, "name");
    const provider = formField(req.body, "provider");
    const effort = formField(req.body, "effort");
    const path = `/models/${encodeURIComponent(req.params.id)}`;
    if (!name || !provider || !isModelEffort(effort)) {
      res.redirect(
        303,
        noticeUrl(path, "Name, provider, and effort are required."),
      );
      return;
    }
    const updated = await store.updateModel(req.params.id, {
      name,
      provider,
      effort,
    });
    res.redirect(303, noticeUrl(path, updated ? "Saved." : "Model not found."));
  });

  router.post("/models/:id/delete", async (req, res) => {
    const result = await store.deleteModel(req.params.id);
    const notice =
      result === "deleted"
        ? "Deleted model."
        : result === "in_use"
          ? "That model is used by a trajectory and cannot be deleted yet."
          : "Model not found.";
    res.redirect(303, noticeUrl("/models", notice));
  });

  return router;
}
