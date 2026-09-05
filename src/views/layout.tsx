import type { PropsWithChildren } from "@kitajs/html";

export function Layout({
  title = "llm-garage",
  children,
}: PropsWithChildren<{ title?: string }>) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title safe>{title}</title>
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
          main {
            padding: 1.5rem;
            max-width: 720px;
            margin: 0 auto;
          }
        `}</style>
      </head>
      <body>
        <header>
          <span class="brand">llm-garage</span>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
