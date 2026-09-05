import { Layout } from "../layout";

export function HomePage() {
  return (
    <Layout title="llm-garage">
      <h1>llm-garage is running</h1>
      <p>
        Express 5 with server-rendered JSX via <code>preact-render-to-string</code>.
        Persistence (TypeORM + SQLite) arrives in M2.
      </p>
      <p>
        Check <a href="/healthz">/healthz</a> for a liveness check.
      </p>
    </Layout>
  );
}
