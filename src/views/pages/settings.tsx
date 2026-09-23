import { Layout } from "../layout";

const settings = [
  {
    href: "/repos",
    title: "Repositories",
    description: "Manage the repositories available for trajectories.",
  },
  {
    href: "/containers",
    title: "Containers",
    description: "View and remove Docker workspaces.",
  },
  {
    href: "/models",
    title: "Models",
    description: "Manage the models available for trajectories.",
  },
  {
    href: "/chatgpt",
    title: "ChatGPT",
    description: "Sign in to run models on a ChatGPT subscription.",
  },
];

export function SettingsPage() {
  return (
    <Layout title="Settings" section="settings">
      <div class="page-intro">
        <h1>Settings</h1>
        <p>Manage the resources used by LLM Garage.</p>
      </div>
      <div class="grid grid-3 settings-grid">
        {settings.map((setting) => (
          <a class="card card-link" href={setting.href}>
            <h2 class="card-title">{setting.title}</h2>
            <p class="card-meta">{setting.description}</p>
          </a>
        ))}
      </div>
    </Layout>
  );
}
