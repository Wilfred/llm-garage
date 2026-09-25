import type { ComponentChildren } from "preact";
import { authState } from "../auth-state";

export type NavigationSection = "settings" | "trajectories" | "spend";

const navItems: Array<{
  href: string;
  label: string;
  section: NavigationSection;
}> = [
  { href: "/trajectories", label: "Trajectories", section: "trajectories" },
  { href: "/spend", label: "Spend", section: "spend" },
  { href: "/settings", label: "Settings", section: "settings" },
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
  const auth = authState.getStore();

  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="dark" />
        <title>
          {title === "LLM Garage" ? title : `${title} · LLM Garage`}
        </title>
        <link rel="stylesheet" href="/styles.css" />
        {refreshSeconds && <script src="/refresh.js" defer />}
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
          <a
            class="button button-primary header-action"
            href="/trajectories/new"
          >
            New trajectory
          </a>
        </header>
        <main
          {...(refreshSeconds
            ? { "data-refresh-seconds": String(refreshSeconds) }
            : {})}
        >
          {children}
        </main>
        <footer>
          <a href="/about">About</a>
          {auth &&
            (auth.signedIn ? (
              <form method="post" action="/auth/signout">
                <button type="submit" class="link-button">
                  Sign out
                </button>
              </form>
            ) : (
              <a href="/auth/signin">Sign in</a>
            ))}
        </footer>
      </body>
    </html>
  );
}
