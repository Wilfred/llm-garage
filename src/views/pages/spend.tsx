import type { SpendGroup, SpendReport, SpendTotals } from "../../store/types";
import { formatTokens, formatUsd } from "../../usage";
import { EmptyState } from "../components";
import { Layout } from "../layout";

export function SpendPage({ spend }: { spend: SpendReport }) {
  return (
    <Layout title="Spend" section="spend">
      <div class="page-header">
        <div>
          <h1>Spend</h1>
          <p>Token usage and cost as reported by OpenRouter.</p>
        </div>
      </div>
      {spend.trajectories === 0 ? (
        <EmptyState>
          No trajectories yet. <a href="/trajectories/new">Start one</a> to see
          what it costs.
        </EmptyState>
      ) : (
        <>
          <div class="grid grid-3 repo-stats">
            <section class="card">
              <h2>Total cost</h2>
              <div class="stat-value">{cost(spend)}</div>
            </section>
            <section class="card">
              <h2>Tokens</h2>
              <div class="stat-value">
                {formatTokens(
                  (spend.usage?.inputTokens ?? 0) +
                    (spend.usage?.outputTokens ?? 0),
                )}
              </div>
            </section>
            <section class="card">
              <h2>Trajectories</h2>
              <a class="stat-value" href="/trajectories">
                {spend.trajectories}
              </a>
            </section>
          </div>
          {spend.unpricedTurns > 0 && (
            <p class="muted small">
              {spend.unpricedTurns}{" "}
              {spend.unpricedTurns === 1 ? "turn" : "turns"} reported tokens
              without a cost, so the totals understate actual spend.
            </p>
          )}
          <section class="dashboard-section">
            <div class="section-heading">
              <h2>By model</h2>
            </div>
            <SpendTable heading="Model" groups={spend.byModel} />
          </section>
          <section class="dashboard-section">
            <div class="section-heading">
              <h2>By repository</h2>
            </div>
            <SpendTable heading="Repository" groups={spend.byRepo} />
          </section>
        </>
      )}
    </Layout>
  );
}

function SpendTable({
  heading,
  groups,
}: {
  heading: string;
  groups: SpendGroup[];
}) {
  return (
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{heading}</th>
            <th class="numeric">Trajectories</th>
            <th class="numeric">Input</th>
            <th class="numeric">Output</th>
            <th class="numeric">Cost</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr>
              <td>{group.label}</td>
              <td class="numeric">{group.trajectories}</td>
              <td class="numeric">{tokens(group.usage?.inputTokens)}</td>
              <td class="numeric">{tokens(group.usage?.outputTokens)}</td>
              <td class="numeric">{cost(group)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function tokens(count: number | undefined): string {
  return count === undefined ? "—" : formatTokens(count);
}

function cost({ usage }: SpendTotals): string {
  return usage?.costUsd === undefined ? "—" : formatUsd(usage.costUsd);
}
