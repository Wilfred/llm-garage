import type { ComponentChildren } from "preact";
import type { Repo, Session, SessionStatus } from "../store/types";
import { getModel } from "../models";

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function StatusBadge({ status }: { status: SessionStatus }) {
  const displayStatus = sessionDisplayStatus(status);
  return <span class={`status status-${displayStatus}`}>{displayStatus}</span>;
}

export function sessionDisplayStatus(
  status: SessionStatus,
): "active" | "archive" | "errored" | "idle" {
  if (status === "running") return "active";
  if (status === "failed") return "errored";
  if (status === "archived") return "archive";
  return "idle";
}

export function EmptyState({ children }: { children: ComponentChildren }) {
  return <div class="empty">{children}</div>;
}

export function SessionCards({
  sessions,
  repos,
}: {
  sessions: Session[];
  repos: Repo[];
}) {
  if (sessions.length === 0) return <EmptyState>No sessions here.</EmptyState>;
  return (
    <div class="grid grid-3">
      {sessions.map((session) => {
        const repo = repos.find((candidate) => candidate.id === session.repoId);
        const model = getModel(session.modelId);
        return (
          <a class="card card-link" href={`/sessions/${session.id}`}>
            <StatusBadge status={session.status} />
            <div class="card-title">{session.title}</div>
            <div class="card-meta">
              <span>
                {repo ? `${repo.owner}/${repo.name}` : "Unknown repository"}
              </span>
              <span>{model.name} via OpenRouter</span>
              <time dateTime={session.updatedAt.toISOString()}>
                {formatDate(session.updatedAt)}
              </time>
            </div>
          </a>
        );
      })}
    </div>
  );
}
