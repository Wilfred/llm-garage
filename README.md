# LLM Garage

This is a website that lets you run agentic coding trajectories against
different models. It's intended for both real work and to A/B test
models to build intuition of their abilities.

Ultimately it spawns agentic trajectories on the current host using
Docker.

## Target Feature Set

(1) Create a pull request for a given GitHub repository, prompt and
model, similar to Claude Code Web or
[OpenHands](https://github.com/All-Hands-AI/OpenHands).

(2) Trajectory tracking: For each trajectory, full metadata of prompts,
output, tool usage, token usage, time taken and cost. Allow trajectories
to be marked public to show to others.

(3) Trajectory feedback: mark which trajectory you think had the best
result, so you can generate a summary of which model is best for your
use cases.

(4) Side-by-side trajectories: Allow multiple linked trajectories to start
with the same prompt, to make A/B testing models easy.

(5) Drive-by trajectories: Allow a repository to opt in to auto-merging
the pull requests its trajectories open, once CI is green.

(6) Spawned trajectories: Allow an active agent to create a durable child
trajectory for related work that cannot be handled by a short-lived
subagent. The parent link records provenance; this is not intended to
be a general user-curated trajectory tree.

**Status: clickable prototype.** The dashboard, repository workflow,
OpenRouter-backed multi-turn trajectory flow, and isolated Docker command execution
are available now. Repository checkout and GitHub integration arrive in later
milestones. See [PLAN.md](PLAN.md) for the full design and milestone roadmap.

## Development

```sh
npm install
cp .env.example .env   # add your OpenRouter API key
npm run dev            # tsx watch, http://127.0.0.1:3000
```

- `npm run build && npm start` — compiled production run
- `npm run lint` — eslint
- `npm test` — unit tests
- `npm run format` — prettier

Repositories and trajectories are stored in SQLite at `DATA_DIR/app.db`
(`data/app.db` by default) and survive restarts.

The Docker daemon must be available to the development process. Each trajectory
gets a container named `llm-garage-trajectory-<id>`, using `alpine:3.22.5` by
default. Set `WORKER_IMAGE` to use another compatible image. Worker containers
have no network access, run as an unprivileged user, and are removed when their
trajectory is archived.

## Docker

```sh
docker build -t llm-garage .
docker volume create llm-garage-data
docker run -d --name llm-garage --restart unless-stopped \
  -p 3000:3000 \
  --env-file .env \
  -e HOST=0.0.0.0 \
  --group-add "$(stat -c '%g' /var/run/docker.sock)" \
  --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock \
  --mount source=llm-garage-data,target=/app/data \
  llm-garage
```

The named volume is required: it stores the SQLite database outside the container so
repository data survives container replacement. Reuse `llm-garage-data` when deploying
a new image, and include that volume in host backups.

Mounting the Docker socket gives LLM Garage control of the host Docker daemon.
Only expose it to a trusted deployment. The first trajectory pulls the configured
worker image if it is not already present.
