import {
  defaultModelEffort,
  modelEfforts,
  type ModelEffort,
} from "../../models";
import type { Model, Trajectory } from "../../store/types";
import { EmptyState, formatDate } from "../components";
import { Layout } from "../layout";

export function ModelsPage({
  models,
  trajectories,
  notice,
}: {
  models: Model[];
  trajectories: Trajectory[];
  notice?: string;
}) {
  const success = notice?.startsWith("Added") || notice?.startsWith("Deleted");
  return (
    <Layout title="Models" section="models">
      <div class="page-header">
        <h1>Models</h1>
        <a class="button button-primary" href="/models/new">
          Add model
        </a>
      </div>
      {notice && (
        <div class={success ? "notice notice-success" : "notice"}>{notice}</div>
      )}
      {models.length === 0 ? (
        <EmptyState>
          No models yet. <a href="/models/new">Add a model</a> before starting a
          trajectory.
        </EmptyState>
      ) : (
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Model</th>
                <th>Provider</th>
                <th>Effort</th>
                <th>Trajectories</th>
              </tr>
            </thead>
            <tbody>
              {models.map((model) => (
                <tr>
                  <td>
                    <a
                      class="repo-name"
                      href={`/models/${encodeURIComponent(model.id)}`}
                    >
                      {model.name}
                    </a>
                    <div class="muted small">{model.id}</div>
                  </td>
                  <td>{model.provider}</td>
                  <td>{model.effort}</td>
                  <td>
                    {
                      trajectories.filter(
                        (trajectory) => trajectory.modelId === model.id,
                      ).length
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  );
}

export function NewModelPage({
  values,
  error,
}: {
  values?: { id: string; name: string; provider: string; effort: string };
  error?: string;
}) {
  return (
    <Layout title="Add model" section="models">
      <div class="breadcrumb">
        <a href="/models">Models</a>
        <span>/</span>
        <strong>Add model</strong>
      </div>
      <h1 class="page-intro">Add model</h1>
      {error && <div class="notice">{error}</div>}
      <form class="card stack form-card" method="post" action="/models">
        <input
          name="id"
          required
          aria-label="OpenRouter model id"
          placeholder="anthropic/claude-opus-5"
          value={values?.id ?? ""}
          autocomplete="off"
        />
        <input
          name="name"
          required
          aria-label="Display name"
          placeholder="Claude Opus 5"
          value={values?.name ?? ""}
          autocomplete="off"
        />
        <input
          name="provider"
          required
          aria-label="Provider"
          placeholder="Anthropic"
          value={values?.provider ?? ""}
          autocomplete="off"
        />
        <EffortSelect selected={values?.effort} />
        <button class="button button-primary" type="submit">
          Add model
        </button>
      </form>
    </Layout>
  );
}

export function ModelDetailPage({
  model,
  trajectories,
  notice,
}: {
  model: Model;
  trajectories: Trajectory[];
  notice?: string;
}) {
  const path = `/models/${encodeURIComponent(model.id)}`;
  return (
    <Layout title={model.name} section="models">
      <div class="breadcrumb">
        <a href="/models">Models</a>
        <span>/</span>
        <strong>{model.name}</strong>
      </div>
      <div class="page-header">
        <h1>{model.name}</h1>
        <form method="post" action={`${path}/delete`}>
          <button class="button button-danger" type="submit">
            Delete model
          </button>
        </form>
      </div>
      {notice && <div class="notice">{notice}</div>}
      <div class="grid grid-3 repo-stats">
        <section class="card">
          <h2>OpenRouter id</h2>
          <div class="stat-value">{model.id}</div>
        </section>
        <section class="card">
          <h2>Provider</h2>
          <div class="stat-value">{model.provider}</div>
        </section>
        <section class="card">
          <h2>Trajectories</h2>
          <div class="stat-value">{trajectories.length}</div>
        </section>
      </div>
      <form class="card stack form-card" method="post" action={path}>
        <h2>Settings</h2>
        <input
          name="name"
          required
          aria-label="Display name"
          value={model.name}
          autocomplete="off"
        />
        <input
          name="provider"
          required
          aria-label="Provider"
          value={model.provider}
          autocomplete="off"
        />
        <EffortSelect selected={model.effort} />
        <button class="button button-primary" type="submit">
          Save
        </button>
      </form>
      <p class="muted small repo-created">
        Added{" "}
        <time dateTime={model.createdAt.toISOString()}>
          {formatDate(model.createdAt)}
        </time>
      </p>
    </Layout>
  );
}

function EffortSelect({
  selected = defaultModelEffort,
}: {
  selected?: string | undefined;
}) {
  return (
    <select name="effort" required aria-label="Reasoning effort">
      {modelEfforts.map((effort: ModelEffort) => (
        <option value={effort} selected={effort === selected}>
          {effort} effort
        </option>
      ))}
    </select>
  );
}
