# LLM Garage

This is a website that lets you run agentic coding sessions against
different models. It's intended for both real work and to A/B test
models to build intuition of their abilities.

Ultimately it spawns agentic sessions on the current host using
Docker.

## Target Feature Set

(1) Create a pull request for a given GitHub repository, prompt and
model, similar to Claude Code Web or
[OpenHands](https://github.com/All-Hands-AI/OpenHands).

(2) Session tracking: For each session, full metadata of prompts,
output, tool usage, token usage, time taken and cost. Allow sessions
to be marked public to show to others.

(3) Session feedback: mark which session you think had the best
result, so you can generate a summary of which model is best for your
use cases.

(4) Side-by-side sessions: Allow multiple linked sessions to start
with the same prompt, to make A/B testing models easy.

(5) Drive-by sessions: Allow a session to create a pull request that
is auto-merged if CI is green.

(6) Forked sessions: Allow a session to create new sessions, so an
issue identified in one session can be spun out to another session to
enable the user to iterate on it. This enables workflows for larger
features or bugs that can't be a shortlived subagent.

**Status: clickable prototype.** The dashboard, repository workflow, and multi-turn
session flow are available now. Runs are scripted fixtures; Docker agents and GitHub
integration arrive in later milestones. See [PLAN.md](PLAN.md) for the full design and
milestone roadmap.

## Development

```sh
npm install
cp .env.example .env   # defaults are fine for local dev
npm run dev            # tsx watch, http://127.0.0.1:3000
```

- `npm run build && npm start` — compiled production run
- `npm run lint` — eslint
- `npm test` — unit tests
- `npm run format` — prettier

Prototype repositories and sessions live in memory and reset whenever the server
restarts. SQLite is initialized at `DATA_DIR/app.db` (`data/app.db` by default) for the
health check; subsequent milestones move prototype workflows to persistent storage.

## Docker

```sh
docker build -t llm-garage .
docker run --rm -p 3000:3000 -v llm-garage-data:/app/data llm-garage
```

From M6 onward the container also needs the Docker socket to spawn sandbox
containers: `-v /var/run/docker.sock:/var/run/docker.sock`.
