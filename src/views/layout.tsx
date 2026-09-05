import type { ComponentChildren } from "preact";

export type NavigationSection = "repos" | "sessions";

const navItems: Array<{
  href: string;
  label: string;
  section: NavigationSection;
}> = [
  { href: "/repos", label: "Repositories", section: "repos" },
  { href: "/sessions", label: "Sessions", section: "sessions" },
];

export function Layout({
  title = "LLM Garage",
  section,
  children,
  refreshSeconds,
}: {
  title?: string;
  section?: NavigationSection;
  children?: ComponentChildren;
  refreshSeconds?: number;
}) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="dark" />
        {refreshSeconds && (
          <meta http-equiv="refresh" content={String(refreshSeconds)} />
        )}
        <title>
          {title === "LLM Garage" ? title : `${title} · LLM Garage`}
        </title>
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body>
        <header class="site-header">
          <a class="brand" href="/" aria-label="LLM Garage dashboard">
            <span class="brand-mark" aria-hidden="true">
              🛠️
            </span>
            <span>LLM Garage</span>
          </a>
          <nav aria-label="Primary navigation">
            {navItems.map((item) => (
              <a
                href={item.href}
                aria-current={section === item.section ? "page" : undefined}
              >
                {item.label}
              </a>
            ))}
          </nav>
          <a class="button button-primary header-action" href="/sessions/new">
            New session
          </a>
        </header>
        <main>{children}</main>
        <footer>
          <a href="/about">About</a>
          <span>
            Prototype data is held in memory and resets when the server
            restarts.
          </span>
        </footer>
      </body>
    </html>
  );
}
