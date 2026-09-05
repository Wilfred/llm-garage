import type { ComponentChildren } from "preact";

export type NavigationSection = "dashboard" | "repos" | "prompts" | "sessions" | "about";

const navItems: Array<{ href: string; label: string; section: NavigationSection }> = [
  { href: "/", label: "Dashboard", section: "dashboard" },
  { href: "/repos", label: "Repositories", section: "repos" },
  { href: "/prompts", label: "Prompts", section: "prompts" },
  { href: "/about", label: "About", section: "about" },
];

export function Layout({
  title = "llm-garage",
  section,
  children,
  scripts = [],
  refreshSeconds,
}: {
  title?: string;
  section?: NavigationSection;
  children?: ComponentChildren;
  scripts?: string[];
  refreshSeconds?: number;
}) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="dark" />
        {refreshSeconds && <meta http-equiv="refresh" content={String(refreshSeconds)} />}
        <title>{title === "llm-garage" ? title : `${title} · llm-garage`}</title>
        <style>{styles}</style>
        {scripts.map((src) => (
          <script src={src} defer />
        ))}
      </head>
      <body>
        <header class="site-header">
          <a class="brand" href="/" aria-label="llm-garage dashboard">
            <span class="brand-mark">lg</span>
            <span>llm-garage</span>
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
          Prototype data is held in memory and resets when the server restarts.
        </footer>
      </body>
    </html>
  );
}

const styles = `
  :root {
    color-scheme: dark;
    --bg: #0c0d10;
    --surface: #14161b;
    --surface-raised: #1a1d23;
    --line: #292d36;
    --line-strong: #3a404c;
    --text: #f1f3f5;
    --muted: #989faa;
    --accent: #b9f27c;
    --accent-ink: #17200e;
    --blue: #7bb7ff;
    --amber: #f5c56b;
    --red: #ff8585;
    --radius: 12px;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: var(--bg); color: var(--text); line-height: 1.5; }
  a { color: var(--blue); text-decoration: none; }
  a:hover { text-decoration: underline; text-underline-offset: 3px; }
  .site-header {
    min-height: 68px; padding: 0 5vw; display: flex; align-items: center; gap: 2rem;
    border-bottom: 1px solid var(--line); background: #0c0d10e8; position: sticky; top: 0;
    backdrop-filter: blur(12px); z-index: 10;
  }
  .brand { color: var(--text); display: flex; align-items: center; gap: .7rem; font-weight: 700; letter-spacing: -.02em; }
  .brand:hover { text-decoration: none; }
  .brand-mark { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 8px; background: var(--accent); color: var(--accent-ink); font: 800 .72rem ui-monospace, monospace; }
  nav { display: flex; align-items: center; gap: .35rem; }
  nav a { color: var(--muted); padding: .45rem .7rem; border-radius: 7px; font-size: .92rem; }
  nav a:hover, nav a[aria-current="page"] { color: var(--text); background: var(--surface-raised); text-decoration: none; }
  .header-action { margin-left: auto; }
  main { width: min(1180px, 90vw); margin: 0 auto; padding: 3rem 0 5rem; }
  footer { border-top: 1px solid var(--line); color: var(--muted); font-size: .8rem; padding: 1.2rem 5vw 2rem; }
  h1, h2, h3 { line-height: 1.15; letter-spacing: -.025em; margin-top: 0; }
  h1 { font-size: clamp(2rem, 5vw, 3.1rem); margin-bottom: .65rem; }
  h2 { font-size: 1.25rem; }
  h3 { font-size: 1rem; }
  p { margin-top: 0; }
  code, pre, textarea.mono { font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; }
  code { background: #232730; border-radius: 4px; padding: .12rem .3rem; }
  .page-header { display: flex; align-items: end; justify-content: space-between; gap: 1rem; margin-bottom: 2rem; }
  .page-header p { color: var(--muted); max-width: 680px; margin-bottom: 0; }
  .eyebrow { color: var(--accent); text-transform: uppercase; letter-spacing: .12em; font-size: .73rem; font-weight: 700; margin-bottom: .65rem; }
  .muted { color: var(--muted); }
  .small { font-size: .82rem; }
  .grid { display: grid; gap: 1rem; }
  .grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .dashboard-section { margin-top: 2.4rem; }
  .section-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; margin-bottom: .8rem; }
  .section-heading h2 { margin-bottom: 0; }
  .count { color: var(--muted); font-size: .82rem; }
  .card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 1.15rem; }
  .card:hover.card-link { border-color: var(--line-strong); background: var(--surface-raised); text-decoration: none; }
  .card-link { color: inherit; display: block; transition: background .15s, border-color .15s; }
  .card-title { font-weight: 650; margin: .55rem 0 .3rem; }
  .card-meta { color: var(--muted); font-size: .82rem; display: flex; flex-wrap: wrap; gap: .35rem .8rem; }
  .status { display: inline-flex; align-items: center; gap: .38rem; border: 1px solid var(--line-strong); border-radius: 99px; padding: .18rem .55rem; color: var(--muted); font-size: .72rem; font-weight: 650; text-transform: uppercase; letter-spacing: .045em; }
  .status::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .status-running, .status-queued { color: var(--blue); }
  .status-awaiting_feedback { color: var(--amber); }
  .status-succeeded { color: var(--accent); }
  .status-failed, .status-cancelled { color: var(--red); }
  .status-archived { color: var(--muted); }
  .button { appearance: none; border: 1px solid var(--line-strong); background: var(--surface-raised); color: var(--text); border-radius: 8px; padding: .58rem .85rem; font: inherit; font-size: .87rem; font-weight: 650; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
  .button:hover { border-color: #626a79; text-decoration: none; }
  .button-primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
  .button-danger { color: var(--red); }
  .button:disabled { opacity: .45; cursor: not-allowed; }
  .actions { display: flex; gap: .55rem; flex-wrap: wrap; align-items: center; }
  form.stack, .stack { display: grid; gap: 1rem; }
  label, legend { font-weight: 650; font-size: .88rem; }
  label span.help { display: block; color: var(--muted); font-weight: 400; font-size: .8rem; margin-top: .15rem; }
  input, select, textarea { width: 100%; margin-top: .4rem; border: 1px solid var(--line-strong); border-radius: 8px; background: #0f1115; color: var(--text); padding: .68rem .75rem; font: inherit; }
  textarea { min-height: 125px; resize: vertical; line-height: 1.5; }
  textarea.preview { min-height: 270px; color: #c9d0da; }
  input:focus, select:focus, textarea:focus { outline: 2px solid #7bb7ff88; outline-offset: 1px; border-color: var(--blue); }
  .field-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
  .check-row { display: flex; gap: 1.4rem; flex-wrap: wrap; }
  .check { display: flex; align-items: center; gap: .55rem; font-weight: 500; }
  .check input { width: auto; margin: 0; accent-color: var(--accent); }
  fieldset { border: 0; padding: 0; margin: 0; }
  .notice { border: 1px solid #6c5b31; background: #2b2414; color: #f5d793; border-radius: 8px; padding: .7rem .85rem; margin-bottom: 1rem; }
  .notice-success { border-color: #365b35; background: #162817; color: #b9f27c; }
  .table-wrap { border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; }
  table { border-collapse: collapse; width: 100%; }
  th, td { padding: .8rem 1rem; text-align: left; border-bottom: 1px solid var(--line); vertical-align: middle; }
  th { color: var(--muted); font-size: .75rem; text-transform: uppercase; letter-spacing: .06em; background: var(--surface); }
  td { font-size: .9rem; }
  tr:last-child td { border-bottom: 0; }
  .split { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(280px, .7fr); gap: 1.25rem; align-items: start; }
  .sticky { position: sticky; top: 92px; }
  .breadcrumb { display: flex; gap: .4rem; align-items: center; flex-wrap: wrap; color: var(--muted); font-size: .82rem; margin-bottom: 1.4rem; }
  .breadcrumb span { color: #555c68; }
  .transcript { display: grid; gap: 1rem; }
  .turn-header { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-bottom: .8rem; }
  .turn-prompt { border-left: 2px solid var(--blue); padding-left: .85rem; color: #dce1e8; white-space: pre-wrap; }
  pre.log { background: #090a0c; color: #c3cad4; border: 1px solid #252932; border-radius: 8px; padding: .85rem; overflow-x: auto; font-size: .78rem; line-height: 1.7; white-space: pre-wrap; }
  details { border-top: 1px solid var(--line); padding-top: .8rem; }
  summary { cursor: pointer; color: var(--muted); font-size: .85rem; }
  .version { border-left: 2px solid var(--line-strong); padding-left: 1rem; }
  .version-current { border-left-color: var(--accent); }
  .version pre { white-space: pre-wrap; color: #d6dae0; }
  .empty { color: var(--muted); border: 1px dashed var(--line-strong); border-radius: var(--radius); padding: 1.5rem; text-align: center; }
  .tree { list-style: none; padding-left: 0; margin: 0; }
  .tree .tree { margin: .45rem 0 0 .8rem; padding-left: .9rem; border-left: 1px solid var(--line-strong); }
  .tree li + li { margin-top: .45rem; }
  .tree a { display: flex; justify-content: space-between; gap: .5rem; color: var(--text); font-size: .85rem; }
  .system-info { display: grid; grid-template-columns: max-content 1fr; gap: .75rem 1.5rem; margin: 1.5rem 0; }
  .system-info dt { font-weight: 650; }
  .system-info dd { margin: 0; }
  @media (max-width: 800px) {
    .site-header { padding: .8rem 5vw; gap: .7rem; flex-wrap: wrap; }
    nav { order: 3; width: 100%; overflow-x: auto; }
    .grid-2, .grid-3, .split, .field-row { grid-template-columns: 1fr; }
    .sticky { position: static; }
    .page-header { align-items: start; flex-direction: column; }
    main { padding-top: 2rem; }
    .system-info { grid-template-columns: 1fr; gap: .25rem; }
    .system-info dd { margin-bottom: .75rem; }
  }
`;
