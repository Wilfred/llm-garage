import type { Repo, Trajectory } from "../../store/types";
import { getModel } from "../../models";
import { sumUsage } from "../../usage";
import { StatusBadge, UsageSummary } from "../components";
import { Layout } from "../layout";
import { renderMarkdown } from "../markdown";
import type { TurnTranscript } from "./trajectories";

export type ComparisonColumn = {
  trajectory: Trajectory;
  transcript: TurnTranscript[];
};

export function ComparisonPage({
  columns,
  repo,
}: {
  columns: ComparisonColumn[];
  repo?: Repo;
}) {
  const first = columns[0];
  if (!first) throw new Error("A comparison needs at least one trajectory");
  const running = columns.some(
    ({ trajectory }) =>
      trajectory.status === "running" || trajectory.status === "queued",
  );
  return (
    <Layout
      title={first.trajectory.title}
      section="trajectories"
      {...(running ? { refreshSeconds: 1 } : {})}
    >
      <div class="breadcrumb">
        <a href="/trajectories">Trajectories</a>
        <span>/</span>
        <strong>{first.trajectory.title}</strong>
      </div>
      <div class="detail-toolbar">
        <span class="count">
          {columns.length} models on the same task
          {repo ? ` · ${repo.owner}/${repo.name}` : ""}
        </span>
      </div>
      <p class="turn-prompt">{first.trajectory.taskPrompt}</p>
      <div class="compare">
        {columns.map(({ trajectory, transcript }) => (
          <section class="card compare-column">
            <div class="compare-heading">
              <a href={`/trajectories/${trajectory.id}`}>
                {getModel(trajectory.modelId).name}
              </a>
              <StatusBadge status={trajectory.status} />
            </div>
            {transcript.map(({ turn, events }, index) => (
              <ComparisonTurn turn={turn} events={events} first={index === 0} />
            ))}
            <UsageSummary
              usage={sumUsage(transcript.map(({ turn }) => turn.usage))}
            />
          </section>
        ))}
      </div>
    </Layout>
  );
}

function ComparisonTurn({
  turn,
  events,
  first,
}: TurnTranscript & { first: boolean }) {
  const output = events
    .filter((event) => event.kind === "model_output")
    .map((event) => event.data)
    .join("\n\n");
  return (
    <>
      {!first && <p class="turn-prompt">{turn.prompt}</p>}
      {output ? (
        <div
          class="model-output"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(output) }}
        />
      ) : (
        <p class="model-output empty-output">No output yet.</p>
      )}
    </>
  );
}
