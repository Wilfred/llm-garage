# Plan: llm-garage — Self-hosted LLM Coding Harness

> **This document is the source of truth for building llm-garage.** It is written to be
> self-contained: any engineer or coding agent should be able to pick up the next
> unfinished milestone and execute it using only this file and the existing code.
> Work in milestone order. Verify each milestone's "Definition of done" before starting
> the next. Commit and push at every milestone boundary.

## Context

Wilfred wants a personal, self-hosted web app he can hand a prompt + a GitHub repo; it
runs a coding agent in an isolated Docker sandbox that iterates on the code, then
optionally opens a PR and optionally auto-merges it when CI is green. Core goals:

1. A tool he can **tailor to his own workflows over time**, especially via an editable,
   versioned library of system prompts.
2. **Sessions as first-class objects, running concurrently**: agent runs form a tree,
   and multiple sessions are active at once (not a one-at-a-time queue). An agent can
   spawn subagent sessions and end itself, leaving individual sessions awaiting human
   feedback so the human can iterate on each independently — and several can be making
   progress in parallel while the human reviews others.
3. **Incremental delivery**: the first deployed version is an utterly trivial Node
   website packaged in Docker. Every milestone after that is independently deployable
   and verified end-to-end before the next begins.

**Decisions already made (do not relitigate):**

- Agent engine: **pluggable `Runner` interface; v1 = OpenAI Codex CLI** (`codex exec`
  inside the sandbox container). Claude-based runners can be added later.
- Sandbox: **Docker containers** via `dockerode` — fresh container per agent turn.
- Frontend: **server-rendered JSX** from Express (`@kitajs/html`), minimal client JS,
  SSE for live logs. No SPA.
- DB: **SQLite via TypeORM** (`better-sqlite3`); GitHub via **PAT** in env + `octokit`.
- The harness website itself is **packaged in Docker** for deployment.

## Execution notes for future sessions

- **The Claude Code cloud environment has no Docker daemon.** Milestones that need
  `docker build`/`docker run` (M0 image verification, M6+) can be *authored* anywhere,
  but must be *verified* on a host with Docker (Wilfred's machine/server). Structure
  work so everything docker-independent is verified in-session, and print the exact
  commands the human should run to verify the docker parts.
- Develop on branch `claude/llm-github-automation-harness-6ags0z` until told otherwise.
- Never commit `node_modules/`, `data/`, `dist/`, or `.env`.
- Keep this file updated: when a milestone is completed, mark it `✅ done (commit <sha>)`.

## Architecture overview

```
Browser ── HTTP/SSE ──> Express app (this repo, runs in Docker)
                           │
                           ├── TypeORM/SQLite (data/app.db on a mounted volume)
                           ├── octokit ──> GitHub API (PRs, checks, merge)
                           ├── dockerode ──> Docker daemon (mounted /var/run/docker.sock)
                           │      └── per-turn sandbox container (git + node + codex)
                           │             └── agent calls back: garage-ctl ──> Agent API
                           └── in-process job queue (p-queue)
```

When the harness itself runs in Docker (production), it needs
`-v /var/run/docker.sock:/var/run/docker.sock` to spawn **sibling** sandbox containers
(not docker-in-docker), and `-v llm-garage-data:/app/data` for the SQLite file.

## Technology choices

| Concern | Choice | Notes |
|---|---|---|
| JSX | `@kitajs/html` | Renders JSX straight to HTML strings — no React runtime/hydration. **Caveat: no auto-escaping**; use `safe`/`Html.escape` for user data and wire `@kitajs/ts-html-plugin` `xss-scan` into the lint script. |
| Server | Express 5 | SSE via raw `res.write`. |
| DB | TypeORM + `better-sqlite3`, WAL mode | `synchronize: true` is fine for this single-user tool; migrations are the documented exit ramp if the data ever becomes precious. |
| Docker | `dockerode` | Per-`exec` env vars are the linchpin of token isolation (see sandbox section). |
| GitHub | `octokit` (umbrella pkg) | PRs, checks, merge. |
| Queue | `p-queue` | In-process; no Redis. **Concurrency > 1 by default** — env `MAX_CONCURRENT_RUNS` (default 3) governs how many turns run at once; effective ceiling is host RAM ÷ per-container memory. See "Concurrency & resource budgeting". |
| Config/validation | `zod` + `dotenv` | Parsed once in `src/config.ts`. |
| Dev runner | `tsx watch` | **Gotcha:** esbuild doesn't emit decorator metadata → every TypeORM column declares an explicit type (`@Column("text")`). Never rely on `emitDecoratorMetadata`. |
| Lint | typescript-eslint (flat) + prettier | |
| IDs | `nanoid` | Session/turn IDs, branch slugs, agent API tokens. |

tsconfig: `jsx: "react-jsx"`, `jsxImportSource: "@kitajs/html"`,
`experimentalDecorators: true`, `module`/`moduleResolution` `nodenext`, `strict: true`,
`outDir: "dist"`. Pick one module strategy that works for both `tsx` (dev) and
`node dist/` (prod) and verify both actually run.

## Directory layout (final shape — grows milestone by milestone)

```
Dockerfile                    # the harness app image (M0: trivial; M1+: multi-stage TS build)
.dockerignore
sandbox/Dockerfile            # agent sandbox image: git + node + codex CLI + git-askpass + garage-ctl
data/                         # sqlite file (gitignored)
src/
  config.ts                   # zod-parsed env
  db/data-source.ts
  entities/                   # Setting, Repo, SystemPrompt, PromptVersion, Session, Turn, RunEvent
  store/types.ts              # DataStore interface (the seam views depend on)
  store/memory.ts             # in-memory fixtures impl (M3 prototype; deleted later)
  store/db.ts                 # TypeORM-backed impl (M4+)
  server/index.ts             # bootstrap: init DB, mount routes, listen
  server/routes/              # health.ts, pages.tsx, repos.ts, prompts.ts, sessions.ts, sse.ts, agent-api.ts
  views/                      # layout.tsx + pages/*.tsx (kitajs)
  runner/types.ts             # Runner interface
  runner/echo.ts              # trivial test runner (no LLM)
  runner/codex.ts             # CodexRunner (v1)
  sandbox/docker.ts           # container/volume create/exec/stream/kill/cleanup
  sandbox/garage-ctl.mjs      # CLI copied into the sandbox image (agent session tool)
  github/client.ts pr.ts checks.ts
  runs/queue.ts manager.ts events.ts
```

## Data model

Two phases. **Phase 1 (M6–M11)** uses a flat `Run` model. **Phase 2 (M12)** generalizes
it into `Session` + `Turn`. Design Phase 1 columns so the rename is mechanical.

### Phase 1 entities

- **Setting** — KV rows (`key` primary text, `value` text). E.g. `basePromptId`,
  `defaultMergeMethod`.
- **Repo** — `id`, `owner`, `name`, `defaultBranch`, `createdAt`. Clone URL is derived
  (`https://github.com/{owner}/{name}.git`); never stored with a token.
- **SystemPrompt** — `id`, `name`, `scope: "global" | "repo"`, `repoId?`, `createdAt`.
- **PromptVersion** — append-only: `id`, `promptId`, `content` (text), `note?`,
  `createdAt`. Editing a prompt inserts a new version; "current" = latest. This gives
  tailoring-over-time history for free.
- **Run** — `id`, `repoId`, `taskPrompt`, `composedSystemPrompt` (**frozen snapshot at
  enqueue** so runs stay reproducible after prompt edits), `status`, `branchName`,
  `createPr` (bool), `autoMerge` (bool), `mergeMethod` (`squash|merge|rebase`),
  `prNumber?`, `prUrl?`, `containerId?`, `error?`, `createdAt/startedAt/finishedAt`.
  - Status machine: `queued → running → (succeeded | failed | cancelled)`; if
    `createPr`: `succeeded → pr_created`; if `autoMerge`:
    `pr_created → awaiting_checks → merging → (merged | merge_failed)`.
    One `transition(run, to)` helper validates edges and appends a status RunEvent.
- **RunEvent** — autoincrement `id` (doubles as SSE `Last-Event-ID`), `runId`,
  `kind: "log" | "status" | "system"`, `data` (text), `ts`. Every container log line and
  status change lands here; SSE replays from it.

### Phase 2 entities (M12 — sessions & turns)

- **Session** — `id`, `parentId?` (self-FK → tree), `rootId` (denormalized for cheap
  tree queries), `repoId`, `title`, `status`
  (`queued | running | awaiting_feedback | succeeded | failed | cancelled | archived`
  plus the PR statuses carried over), `branchName`, `workspaceVolume?` (docker named
  volume `llm-garage-ws-<id>` that persists between turns), PR fields, timestamps.
- **Turn** — one agent invocation within a session: `id`, `sessionId`, `kind:
  "initial" | "feedback" | "spawn"`, `prompt` (the task or the human's feedback),
  `composedSystemPrompt` snapshot, `status`, `containerId?`, `error?`, timestamps.
- **RunEvent** — re-keyed to `turnId`.

Migration note: `Run` ≈ `Session with exactly one Turn`. With `synchronize: true` and
cheap data, it is acceptable to write a small one-off script (or accept data loss) at
the M12 boundary — decide when you get there.

## Run orchestration (Phase 1)

- `runs/queue.ts`: p-queue with `concurrency = MAX_CONCURRENT_RUNS` (default 3) — up to
  N turns execute simultaneously, each in its own container/workspace/branch, so they
  never collide. Enqueue persists Run as `queued`. On startup: re-enqueue `queued`
  runs, mark orphaned `running` runs `failed`, sweep leftover containers by label
  (`llm-garage=1`).
- `runs/manager.ts` — `executeRun(runId)`: transition `running` → create container →
  exec clone (token env on this exec only, `git checkout -b <branch>`) → exec runner
  (streaming) → exec push if changes and `createPr` → PR/CI phases →
  `container.remove({force: true, v: true})` in `finally`.
- `runs/events.ts`: per-run EventEmitter; each event is (a) inserted as RunEvent,
  (b) broadcast to SSE subscribers. **Redact `GITHUB_TOKEN` / `OPENAI_API_KEY` values
  from log lines before persistence.**
- SSE `GET /runs/:id/events`: replay RunEvents past `Last-Event-ID`, then live;
  heartbeat comment every 25s; close on terminal status. Client is ~20 lines of vanilla
  `EventSource` appending to a `<pre>` — the only client JS in the app.
- Cancellation: `POST /runs/:id/cancel` → force-remove container → `cancelled`.
- Timeout: manager-side timer (env `RUN_TIMEOUT_MINUTES`, default 30) → kill → `failed`.

### Concurrency & resource budgeting

Multiple active sessions is a first-class requirement, so the queue runs several turns
at once. The consequences to design for:

- **Host memory is the real limit.** Each turn is a container capped at `Memory: 2GB`
  (env `SANDBOX_MEMORY_MB`). So `MAX_CONCURRENT_RUNS × SANDBOX_MEMORY_MB` must fit in
  host RAM with headroom for the harness itself. Document this; on startup, log the
  computed budget and warn if it exceeds a configured `HOST_MEMORY_MB`. The queue — not
  the number of sessions — is the throttle: you can have 50 sessions and only N running.
- **SQLite is not the bottleneck.** The app is a single process with a single
  better-sqlite3 connection, which serializes queries in-process — concurrent turns
  never produce `SQLITE_BUSY` against each other (WAL + `busy_timeout` still set for
  safety). Because writes are synchronous and block the event loop, batch high-frequency
  RunEvent log inserts (coalesce a container's stdout into ~250ms flushes) so N chatty
  turns don't stall the server. This batching is the one concurrency-specific code
  change; everything else (per-run EventEmitter, SSE, CI pollers, containers, branches,
  workspaces) is already per-run and parallel-safe by construction.
- **GitHub API pressure**: N concurrent CI pollers share the PAT's rate limit; keep the
  45s interval and jitter poll start times so they don't align.
- **Fairness**: p-queue is FIFO. Spawned child turns enqueue behind existing work
  rather than preempting it, so a fan-out can't starve the human's manual runs. Adjust
  later if a priority lane is wanted.

## Docker sandbox & token isolation

`sandbox/Dockerfile`: `node:22-bookworm-slim` + git + `npm i -g @openai/codex` +
`/usr/local/bin/git-askpass` (a 2-line sh script that prints `$GIT_TOKEN`) + `garage-ctl`
(M13) + non-root `agent` user, workdir `/work`.

The sandbox container is created with **no secrets in its env**. Docker `exec` supports
per-exec env, so:

- **Clone/push execs:** `GIT_ASKPASS=/usr/local/bin/git-askpass`, `GIT_TOKEN=<pat>`,
  `GIT_TERMINAL_PROMPT=0`. The remote URL is plain `https://github.com/o/r.git` — the
  token never touches `.git/config`, history, or the agent's environment.
- **Agent exec:** `OPENAI_API_KEY` only (plus `GARAGE_SESSION_TOKEN`/`GARAGE_API_URL`
  from M13). The agent process cannot read the GitHub token.

HostConfig limits: `Memory: 2GB`, `NanoCpus: 2e9`, `PidsLimit: 512`. Network: default
bridge in v1 (codex and git need egress); egress filtering is a future hardening item.
All containers and volumes labeled `llm-garage=1` for reaping.

## Runner interface (pluggable)

```ts
interface Runner {
  name: string;
  run(ctx: {
    exec: (cmd: string[], env: Record<string, string>) => ExecStream; // bound to the turn's container
    workdir: string;
    taskPrompt: string;
    systemPrompt: string;
    resume: boolean;                     // M12: continue in an existing workspace
    onEvent: (e: RunnerEvent) => void;   // log lines / progress
    signal: AbortSignal;                 // cancellation/timeout
  }): Promise<{ status: "succeeded" | "failed"; summary?: string }>;
}
```

- **EchoRunner** (M6): ignores the LLM entirely — writes a marker file, echoes the
  prompts, exits 0. Exists so the whole pipeline is verifiable without codex/API keys.
- **CodexRunner** (M7): writes the composed system prompt to `/work/AGENTS.md` (codex
  reads it natively; delete it before push so it is never committed), invokes roughly
  `codex exec --json --sandbox danger-full-access -C /work "<task>"` (Docker is the
  sandbox; codex's own Landlock sandbox off — it often fails in containers anyway),
  parses the `--json` JSONL stream into RunnerEvents. For resume (M12):
  `codex exec resume --last` in the same workspace. **The codex CLI churns — verify
  current flag names against the installed version before wiring anything.**

## GitHub flow

- Fine-grained PAT scoped to the target repos: Contents RW, Pull requests RW,
  Checks/Statuses R.
- Branch naming: `llm-garage/run-{id}-{slug(taskPrompt, 30)}`.
- PR: `octokit.rest.pulls.create({ base: defaultBranch, head, title, body })`; body
  includes the task prompt + a link back to the local session page.
- **CI watching: polling, not webhooks** (self-hosted, possibly behind NAT). Per run in
  `awaiting_checks`, poll every 45s: `checks.listForRef` + combined status for the head
  SHA. All green → `pulls.merge({ merge_method })` → `merged`. Any failure/conflict →
  `merge_failed` with the reason as a RunEvent. Deadline 2h → `merge_failed(timeout)`.
  Zero-check repos: treat "no check runs after 3 polls + combined status success/none"
  as green. Pollers are rebuilt from DB state on server restart.

## Prompt composition & tailoring

At enqueue: global base prompt (Setting `basePromptId`) + repo-scoped prompt(s) +
per-run textarea, joined with `## <section>` headers → snapshot into
`composedSystemPrompt`, shown read-only on the session page ("what the agent actually
saw"). `/prompts` UI: list, create, edit (= append new version), per-prompt version
history; later: version diffs (`diff` npm package), "clone prompt from run".

## Sessions & the agent session-control tool (Phase 2)

The end state the user wants: an agent can **decompose work into subagent sessions and
get out of the way** — spawn children, end itself, and let the human iterate on each
child session individually.

### Session semantics (M12)

- Sessions form a tree (`parentId`). The UI shows the tree, an **"active" list** (all
  sessions whose current turn is `running` or `queued`), and an **"awaiting feedback"
  inbox**. Multiple sessions are active at once, bounded by `MAX_CONCURRENT_RUNS`.
- A session's workspace is a named docker volume that persists across turns; each turn
  runs in a fresh container with that volume mounted at `/work`. Because every session
  has its own volume, branch, and container, concurrent sessions are fully isolated —
  no extra locking needed.
- **Per-session turn serialization:** a single session runs at most one turn at a time
  (a feedback turn can't start until the prior turn ends), but *different* sessions run
  concurrently. The queue enforces both: one in-flight turn per session, ≤ N in-flight
  turns overall.
- **Human feedback loop:** a session that finishes a turn goes to `awaiting_feedback`
  (unless archived/failed). The human opens it, reads the transcript/diff, and either
  (a) sends feedback → new `feedback` Turn resuming in the same workspace, (b) triggers
  push/PR, or (c) archives it.
- **Archive:** terminal. Sets status `archived`, force-removes any container, deletes
  the workspace volume, keeps transcript rows for history.

### Agent API + `garage-ctl` (M13)

The agent controls sessions through a tiny CLI (`garage-ctl`, a single-file Node script
baked into the sandbox image) that talks HTTP to the harness. CLI-over-HTTP is
engine-agnostic — any runner that can shell out can use it.

- **Reachability:** the harness listens on the docker bridge; sandbox containers get
  `--add-host=garage.host:host-gateway` (Linux: requires the daemon's
  `host-gateway` support; fallback is the bridge gateway IP). `GARAGE_API_URL`
  env points at it.
- **Auth:** per-turn bearer token (`GARAGE_SESSION_TOKEN`, nanoid) injected only into
  the agent exec's env; scoped to that session's tree; revoked when the turn ends.
- **Endpoints** (`src/server/routes/agent-api.ts`, all JSON):
  - `GET  /api/agent/sessions` — list sessions in the caller's tree: id, title, status,
    parentId, last-turn summary.
  - `GET  /api/agent/sessions/:id` — one session: metadata + recent transcript events.
  - `POST /api/agent/sessions` — spawn a child: `{title, taskPrompt, systemPromptExtra?}`.
    Child is created `queued` with `parentId = caller`, same repo, fresh workspace
    (branched from the parent's branch). Returns the child id.
  - `POST /api/agent/sessions/:id/archive` — archive a session in the caller's tree.
  - `POST /api/agent/self/finish` — end the caller's own turn:
    `{status: "awaiting_feedback" | "succeeded", messageForHuman}`. This is how a parent
    "closes itself" after spawning children.
- **`garage-ctl` subcommands** map 1:1: `list`, `show <id>`, `spawn --title … --prompt …`,
  `archive <id>`, `finish --status … --message …`. Output is compact JSON for the agent
  to read.
- **Prompt wiring:** when a runner starts, the harness appends a generated "Harness
  tools" section to the composed system prompt documenting these commands, so every
  engine learns the tool the same way.
- **Safety rails:** spawn depth ≤ 3, ≤ 8 live children per session, children inherit
  the queue (no fan-out past `MAX_CONCURRENT_RUNS`), tokens are tree-scoped so an agent
  can never see or archive unrelated sessions.

## Security

- Secrets only in process env + per-exec docker env; never in DB rows or views;
  redaction pass on log lines before persistence.
- kitajs escaping enforced by `xss-scan` in the lint script.
- Non-root container user, resource limits, fresh container per turn, label-based
  reaping of containers and volumes.
- App binds `127.0.0.1` by default (env `HOST`); the agent API binds the docker bridge
  and requires a bearer token; optional basic-auth middleware via env if the UI is ever
  exposed beyond localhost.

---

## Milestones

Each milestone lists **Build** and **Definition of done** (verification). Do not start
milestone N+1 until N's definition of done has been demonstrated. Commit + push at each
boundary. Mark milestones done in this file as you go.

### M0 — Utterly trivial Node website, packaged in Docker ✅ done (this PR)

> Verified in-session with `node` + `curl`; this is the first milestone PR. Verify the
> image on a Docker host:
> `docker build -t llm-garage . && docker run --rm -p 3000:3000 llm-garage`.
> The trivial `server.mjs` + `Dockerfile` are replaced by the TypeScript app in M1.

**The first deployed artifact.** No TypeScript, no dependencies, no framework.

**Build:** `server.mjs` at the repo root using only `node:http` — serves a one-line
HTML page at `/` and `{"ok":true}` at `/healthz`; reads `PORT` (default 3000) and
`HOST` (default 0.0.0.0). Plus `Dockerfile` (`node:22-bookworm-slim`, non-root `node`
user, `CMD ["node","server.mjs"]`) and `.dockerignore`.

**Definition of done:**
- In any environment: `node server.mjs &` then `curl -s localhost:3000/healthz` →
  `{"ok":true}` and `curl -s localhost:3000/` returns HTML.
- On a Docker host: `docker build -t llm-garage . && docker run --rm -p 3000:3000
  llm-garage` then the same curls. **Deploy this before continuing.**

### M1 — TypeScript + Express + JSX skeleton 🔜 built, ships in the next PR (with M2)

**Build:** full scaffolding (package.json scripts `dev/build/start/lint/format`,
tsconfig per above, eslint flat config, prettier, `.env.example`, `.gitignore`);
Express 5 app; kitajs `layout.tsx` + home page; `/healthz` returning `{ok:true}` (no DB
yet). Delete `server.mjs`. Evolve `Dockerfile` into a multi-stage build
(deps → `tsc` build → slim runtime running `node dist/server/index.js`).

**Definition of done:** `npm run lint` clean; `npm run dev` + curls of `/` and
`/healthz`; `npm run build && npm start` + same curls; on a Docker host,
`docker build` + `docker run` + same curls.

### M2 — TypeORM + SQLite wired 🔜 built, ships in the next PR (with M1)

> Verified in-session: lint (eslint + xss-scan) clean; `tsx` dev server and compiled
> `node dist/` both serve `/` and `/healthz` → `{"ok":true,"db":true}`; `data/app.db`
> created with WAL. **Pending on a Docker host:** `docker build -t llm-garage . &&
> docker run --rm -p 3000:3000 -v llm-garage-data:/app/data llm-garage` + same curls.
> Note: TypeScript pinned to 5.9 (kitajs ts-html-plugin peer requires ^5.9.3, not TS 6).

**Build:** `src/db/data-source.ts` (better-sqlite3, WAL, `synchronize: true`, db file at
`${DATA_DIR}/app.db`), `Setting` entity, healthz extended to `{ok:true, db:true}` via a
trivial query, bootstrap initializes the DataSource before listening. Docker: declare
the data dir as a volume and document `-v llm-garage-data:/app/data`.

**Definition of done:** healthz reports `db:true`; `data/app.db` created on first run;
restart keeps data; build + start (non-dev) also works.

> Note: M1+M2 were built together by the initial scaffolding session — that is fine;
> verify both definitions of done, then mark both.

### M3 — Clickable UI prototype (dummy backend)

**Purpose:** let Wilfred play with the whole intended UX — navigation, forms, the
session flow — and react to it *before* the entity/DB/orchestration design is locked in.
Everything is driven by in-memory fixtures behind a swappable data-access seam, so the
real backend later drops in underneath the same views without rewriting them.

**Build:**
- **`DataStore` interface** — the seam every route/view depends on (list/get/create
  repos, prompts + versions, sessions + turns + events). Ship an **in-memory
  implementation** seeded with fixtures: a few repos; a couple of system prompts each
  with 2–3 versions; several sessions spanning every status (`running`,
  `awaiting_feedback`, `succeeded`, `failed`, `archived`) arranged in a small parent/
  child tree; canned log lines per turn.
- **All pages, navigable end-to-end**, rendered with kitajs (escaped): dashboard
  (**active list** + awaiting-feedback inbox + recent sessions), repos list/add/delete,
  prompts list/edit/version-history + base-prompt setting, new-session form (runner
  select, `createPr`/`autoMerge` toggles, live composed-prompt preview), session detail
  (tree breadcrumb, transcript/log `<pre>`, feedback form, cancel/archive buttons, PR
  link placeholder).
- **Forms mutate the in-memory store** (POST-redirect-GET) so it feels live within a
  server run; state resets on restart (documented, expected). "Running" a session is
  faked: on submit it appends a few scripted log lines over ~2s and flips to
  `awaiting_feedback` — enough to feel the loop without SSE/Docker/agents.
- **No Docker, no TypeORM writes, no GitHub, no real agent.** The M2 `Setting`/DB stays
  wired only for `/healthz`; all prototype data lives in the store.
- **Keep the seam honest:** views import only `DataStore`. Later milestones implement
  `DataStore` over TypeORM + real orchestration and delete the in-memory impl — the
  fixtures are throwaway, the interface and views are not.

**Definition of done:** in a browser, click through every page; add/delete a repo; edit
a prompt and see a new version; start a session from the form and watch it move to
`awaiting_feedback` with canned logs; send feedback (adds a turn); archive it; every nav
link resolves; `npm run lint` clean. Deployable via Docker so Wilfred can host it and
play. **This is the checkpoint to critique the UX before backend work (M4+) begins.**

### M4 — Repos CRUD

> Implements the repos slice of `DataStore` over TypeORM (replacing fixtures); the M3
> views are reused unchanged.

**Build:** `Repo` entity; `/repos` list page, add form (owner, name, defaultBranch),
delete button. Plain HTML forms, POST-redirect-GET, kitajs views, escaped output.

**Definition of done:** add/delete a repo in the browser; data survives restart;
`npm run lint` (incl. xss-scan) clean.

### M5 — Prompt library with versioning

**Build:** `SystemPrompt` + `PromptVersion` entities; `/prompts` list/create; edit page
that appends a new version; version history page; settings page selecting the global
base prompt (Setting row).

**Definition of done:** create a prompt, edit it twice → history shows 3 versions with
timestamps; set it as base prompt; all survives restart.

### M6 — Run pipeline with EchoRunner (no LLM, no GitHub writes)

**Build:** `sandbox/Dockerfile` + `npm run sandbox:build`; `sandbox/docker.ts`
(dockerode: create/exec-with-env/stream/kill, labels, volume-less v1); `Run` +
`RunEvent` entities + `transition()`; `runs/queue.ts`, `runs/manager.ts`,
`runs/events.ts` with log redaction; **EchoRunner**; new-run form (repo, task prompt)
+ run detail page rendering persisted RunEvents on refresh (no SSE yet); cancel button;
timeout; startup sweep + orphan handling. Clone step uses the git-askpass mechanism
(read-only use of the PAT).

**Definition of done (on a Docker host):** create a run against a scratch repo → status
walks `queued → running → succeeded`; run page shows clone output + echo output after
refresh; `docker ps` shows the labeled container during and nothing after; cancel
mid-run yields `cancelled` and no leftover container; grep the RunEvent rows for the
PAT value → zero hits. **Concurrency check:** with `MAX_CONCURRENT_RUNS=2`, start three
runs at once → `docker ps` shows exactly two labeled containers running and the third
`queued`; all three finish; a fourth run started with `MAX_CONCURRENT_RUNS=1` while two
are active stays `queued` until a slot frees.

### M7 — CodexRunner

**Build:** spike first, in a throwaway container on the Docker host: confirm the exact
`codex exec` invocation, JSON output flag, and API-key auth work non-interactively with
the pinned `@openai/codex` version; then implement `runner/codex.ts` (AGENTS.md
injection, JSONL parsing → RunnerEvents, AGENTS.md cleanup), runner selection on the
new-run form (echo|codex), `OPENAI_API_KEY` required only when codex selected.

**Definition of done (Docker host):** run "add a haiku to README.md" against a scratch
repo with codex → `succeeded`; run page shows codex's streamed activity; workspace diff
inside the container (or a debug "show diff" exec) proves the file changed; EchoRunner
still passes M6's checks.

### M8 — Live logs via SSE

**Build:** `sse.ts` route (replay from `Last-Event-ID`, live subscribe, 25s heartbeat,
close on terminal status); the single `EventSource` client snippet in the run page;
live status badge swap.

**Definition of done:** open the run page, then start the run from another tab → logs
stream in without refresh; reload mid-run → no lost lines (replay works); two tabs
stream simultaneously.

### M9 — Push + PR creation

**Build:** push exec (askpass env, only when the workspace has commits and `createPr`
is set); `github/client.ts` + `pr.ts`; `pr_created` state + PR link on the run page;
`createPr` toggle on the new-run form. Commit convention: agent commits during the run,
with a final `git add -A && git commit` fallback by the manager if the runner left
uncommitted changes.

**Definition of done (Docker host):** codex run with `createPr` on → PR appears on
GitHub with prompt-derived title/body; `git log`/`git config -l` in the PR branch show
**no token anywhere**; run with toggle off stops at `succeeded` and pushes nothing.

### M10 — CI polling + auto-merge

**Build:** `github/checks.ts` poller (45s interval, per-run, rebuilt from DB on
startup); states `awaiting_checks/merging/merged/merge_failed`; `autoMerge` toggle +
merge-method select on the new-run form; zero-checks rule; 2h deadline.

**Definition of done (Docker host):** scratch repo with a trivial always-green GitHub
Action → run auto-merges (squash) and ends `merged`; add an always-failing action →
`merge_failed` with the failing check named in a RunEvent; restart the server while a
run is `awaiting_checks` → it still merges.

### M11 — Tailoring polish

**Build:** composed-prompt preview on the new-run form (shows global+repo+extra
sections); read-only composed prompt on the run page; "re-run with edits" (prefills a
new-run form from an old run); recent-runs dashboard on `/`; prompt version diff view;
optional basic-auth middleware behind env.

**Definition of done:** dogfood loop — edit a repo prompt, preview composition, run,
inspect what the agent saw, re-run with edits; diff view shows prompt changes.

### M12 — Sessions & turns (tree + human feedback loop)

**Build:** rename/generalize per "Phase 2 entities": `Session` (+`parentId`, `rootId`,
`workspaceVolume`, `awaiting_feedback`/`archived` statuses) and `Turn`; per-session
named docker volume mounted at `/work` (created on first turn, reused on later turns);
runner `resume` flag (codex: `codex exec resume --last`); feedback form on the session
page → new `feedback` Turn; archive action (remove volume + container, keep rows);
session tree + **active list** + awaiting-feedback inbox on the dashboard; queue/startup
logic updated for turns, enforcing one in-flight turn per session and ≤ N overall.

**Definition of done (Docker host):** start a session, let it finish →
`awaiting_feedback`; send feedback ("also update the CHANGELOG") → second turn resumes
in the same workspace and sees the first turn's changes; archive → volume gone
(`docker volume ls`), transcript still readable; tree page renders parent/child.
**Concurrency check:** start three independent sessions → the dashboard's active list
shows up to `MAX_CONCURRENT_RUNS` running with the rest queued, each in its own volume
(`docker volume ls` shows one `llm-garage-ws-*` per session); sending feedback to a
session that already has a running turn is rejected/queued, never runs two turns of the
same session at once.

### M13 — Agent session-control tool (`garage-ctl` + Agent API)

**Build:** `agent-api.ts` routes with per-turn bearer tokens (tree-scoped, revoked at
turn end); `sandbox/garage-ctl.mjs` (fetch-based, subcommands `list/show/spawn/archive/
finish`, reads `GARAGE_API_URL` + `GARAGE_SESSION_TOKEN`) baked into the sandbox image;
`--add-host=garage.host:host-gateway` on sandbox containers + harness listening on the
bridge; auto-appended "Harness tools" section in the composed system prompt; spawn
limits (depth ≤ 3, ≤ 8 live children); children appear in the tree UI as they spawn.

**Definition of done (Docker host):** give a parent session a prompt like "split this
task into two subtasks, spawn a session for each, then finish yourself with a summary"
→ two child sessions appear queued/running in the tree, the parent ends
`awaiting_feedback` with its `messageForHuman` shown; each child can then be iterated
via feedback independently; a forged/expired token gets 401; a child cannot archive a
session outside its tree.

---

## Risk register

1. **Codex CLI flags/auth in-container** — highest uncertainty; spiked at the start of
   M7; EchoRunner keeps the pipeline verifiable regardless.
2. **No Docker in the cloud dev environment** — M0 image, M6, M7, M9, M10, M12, M13
   need final verification on a Docker host; author + unit-verify everything else
   in-session and hand the human exact verification commands.
3. **`codex exec resume` semantics** (M12) — verify resume actually replays context in
   the pinned codex version; fallback: prepend a transcript summary to the next turn's
   task prompt.
4. **Linux `host-gateway` support** (M13) — needs Docker ≥ 20.10; fallback to the
   bridge gateway IP from `dockerode`'s network inspect.
5. **kitajs escaping discipline** — mitigated by `xss-scan` in lint.
6. **tsx + decorator metadata** — mitigated by explicit column types everywhere.
7. **`synchronize: true` drift** — acceptable; migrations documented as exit ramp; the
   M12 remodel may drop dev data (acceptable, note it in the commit message).
8. **Zero-CI repos in auto-merge** — "no checks after 3 polls = green" rule; revisit.
9. **Open container egress in v1** — documented hardening item.
10. **Host resource exhaustion from concurrency** — N concurrent 2GB containers can
    OOM the host. Mitigated by the `MAX_CONCURRENT_RUNS × SANDBOX_MEMORY_MB` budget
    check on startup and hard per-container limits; the queue caps in-flight turns
    regardless of how many sessions exist.
11. **Event-loop stalls under many chatty concurrent turns** — synchronous SQLite
    writes × N high-log turns; mitigated by batching RunEvent inserts (~250ms flush).

## Critical files

- `src/runs/manager.ts` — run/turn lifecycle; docker/runner/github/events meet here
- `src/sandbox/docker.ts` — container + volume lifecycle, per-exec-env token isolation
- `src/runner/codex.ts` — v1 Runner impl + JSONL parsing
- `src/server/routes/agent-api.ts` — the agent's session-control surface (M13)
- `src/entities/` — Run→Session/Turn state machines; the schema everything hangs off
- `src/server/index.ts` — Express bootstrap
