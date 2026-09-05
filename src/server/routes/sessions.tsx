import { Router } from "express";
import { isModelId } from "../../models";
import type { DataStore, Repo, Session } from "../../store/types";
import {
  NewSessionPage,
  NotFoundPage,
  SessionDetailPage,
  SessionsPage,
  type TurnTranscript,
} from "../../views/pages/sessions";
import { renderPage } from "../../views/render";
import { formField, queryString } from "./forms";

export function createSessionsRouter(store: DataStore): Router {
  const router = Router();

  router.get("/sessions", async (req, res) => {
    const [repos, sessions] = await Promise.all([
      store.listRepos(),
      store.listSessions(),
    ]);
    const repoId = queryString(req.query.repoId);
    const { selectedRepo, visibleSessions } = filterSessionsByRepo(
      repos,
      sessions,
      repoId,
    );
    res
      .type("html")
      .send(
        renderPage(
          <SessionsPage
            repos={repos}
            sessions={visibleSessions}
            selectedRepo={selectedRepo}
          />,
        ),
      );
  });

  router.get("/sessions/new", async (req, res) => {
    const [repos, sessions] = await Promise.all([
      store.listRepos(),
      store.listSessions(),
    ]);
    res
      .type("html")
      .send(
        renderPage(
          <NewSessionPage
            repos={repos}
            sessions={sessions}
            selectedRepoId={queryString(req.query.repoId)}
          />,
        ),
      );
  });

  router.post("/sessions", async (req, res) => {
    const repoId = formField(req.body, "repoId");
    const title = formField(req.body, "title");
    const taskPrompt = formField(req.body, "taskPrompt");
    const modelId = formField(req.body, "modelId");
    if (!repoId || !title || !taskPrompt || !isModelId(modelId)) {
      const [repos, sessions] = await Promise.all([
        store.listRepos(),
        store.listSessions(),
      ]);
      res
        .status(400)
        .type("html")
        .send(
          renderPage(
            <NewSessionPage
              repos={repos}
              sessions={sessions}
              selectedRepoId={repoId}
              error="Repository, model, title, and task are required."
            />,
          ),
        );
      return;
    }
    const session = await store.createSession({
      repoId,
      parentId: formField(req.body, "parentId") || undefined,
      title,
      taskPrompt,
      modelId,
      createPr:
        formField(req.body, "createPr") === "yes" ||
        formField(req.body, "autoMerge") === "yes",
      autoMerge: formField(req.body, "autoMerge") === "yes",
    });
    res.redirect(303, `/sessions/${session.id}`);
  });

  router.get("/sessions/:id", async (req, res) => {
    const session = await store.getSession(req.params.id);
    if (!session) {
      res
        .status(404)
        .type("html")
        .send(
          renderPage(<NotFoundPage message="That session does not exist." />),
        );
      return;
    }
    const [repo, sessions, turns] = await Promise.all([
      store.getRepo(session.repoId),
      store.listSessions(),
      store.listTurns(session.id),
    ]);
    const transcript: TurnTranscript[] = await Promise.all(
      turns.map(async (turn) => ({
        turn,
        events: await store.listRunEvents(turn.id),
      })),
    );
    const breadcrumb = buildBreadcrumb(session, sessions);
    const tree = sessions.filter(({ rootId }) => rootId === session.rootId);
    res
      .type("html")
      .send(
        renderPage(
          <SessionDetailPage
            session={session}
            repo={repo}
            breadcrumb={breadcrumb}
            tree={tree}
            transcript={transcript}
          />,
        ),
      );
  });

  router.post("/sessions/:id/feedback", async (req, res) => {
    const feedback = formField(req.body, "feedback");
    if (feedback) await store.addFeedback(req.params.id, feedback);
    res.redirect(303, `/sessions/${req.params.id}`);
  });

  router.post("/sessions/:id/cancel", async (req, res) => {
    await store.cancelSession(req.params.id);
    res.redirect(303, `/sessions/${req.params.id}`);
  });

  router.post("/sessions/:id/archive", async (req, res) => {
    await store.archiveSession(req.params.id);
    res.redirect(303, `/sessions/${req.params.id}`);
  });

  return router;
}

export function filterSessionsByRepo(
  repos: Repo[],
  sessions: Session[],
  repoId?: string,
): { selectedRepo?: Repo; visibleSessions: Session[] } {
  const selectedRepo = repoId
    ? repos.find((candidate) => candidate.id === repoId)
    : undefined;
  return {
    selectedRepo,
    visibleSessions: selectedRepo
      ? sessions.filter((session) => session.repoId === selectedRepo.id)
      : sessions,
  };
}

function buildBreadcrumb(session: Session, sessions: Session[]): Session[] {
  const result: Session[] = [session];
  let current = session;
  while (current.parentId) {
    const parent = sessions.find(({ id }) => id === current.parentId);
    if (!parent || result.some(({ id }) => id === parent.id)) break;
    result.unshift(parent);
    current = parent;
  }
  return result;
}
