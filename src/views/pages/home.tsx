import { Layout } from "../layout";

export function HomePage() {
  return (
    <Layout title="llm-garage">
      <h1>llm-garage is running</h1>
      <p>
        M1 skeleton: Express 5 with server-rendered JSX via <code>@kitajs/html</code>.
        Persistence (TypeORM + SQLite) arrives in M2.
      </p>
      <p>
        Check <a href="/healthz">/healthz</a> for a liveness check.
      </p>
    </Layout>
  );
}
