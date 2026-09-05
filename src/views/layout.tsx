import type { ComponentChildren } from "preact";

export function Layout({
  title = "llm-garage",
  children,
}: {
  title?: string;
  children?: ComponentChildren;
}) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <style>{`
          :root { color-scheme: light dark; }
          body {
            font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
            margin: 0;
            padding: 0;
            line-height: 1.5;
          }
          header {
            padding: 0.75rem 1.5rem;
            border-bottom: 1px solid #8884;
            display: flex;
            align-items: center;
            gap: 0.5rem;
          }
          header .brand {
            font-weight: 600;
            letter-spacing: -0.01em;
          }
          header a {
            color: inherit;
            text-decoration: none;
          }
          main {
            padding: 1.5rem;
            max-width: 720px;
            margin: 0 auto;
          }
          .system-info {
            display: grid;
            grid-template-columns: max-content 1fr;
            gap: 0.75rem 1.5rem;
            margin: 1.5rem 0;
          }
          .system-info dt { font-weight: 600; }
          .system-info dd { margin: 0; }
          @media (max-width: 480px) {
            .system-info { grid-template-columns: 1fr; gap: 0.25rem; }
            .system-info dd { margin-bottom: 0.75rem; }
          }
        `}</style>
      </head>
      <body>
        <header>
          <a class="brand" href="/">
            llm-garage
          </a>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
