# LLM Garage

This is a website that lets you run agentic coding trajectories against
different models. It's intended for both real work and to A/B test
models to build intuition of their abilities.

Ultimately it spawns agentic trajectories on the current host using
Docker.

Loosely inspired by Claude Code Web and
[OpenHands](https://github.com/All-Hands-AI/OpenHands)

## Current Features

- Clone a GitHub repository, have an agent make changes, and create a
  PR (for coding tasks).
- View the full details of the agent's trajectory and cost (for
  understanding agent behaviours).
- Spawn multiple trajectories for the same prompt (for A/B comparing
  models).

## Planned Features

- Allow trajectories to be made public to share with others.
- Mark which trajectory you like the most, so you can accumulate data
  on your favourite models.
- Auto merging: Allow repositories to opt-in to auto merging accepted PRs once
  CI is green.
- Spawn trajectory tool: Allow an agent to start an additional
  trajectory, so the user can fork work.

## Tools

- Run Linux commands in a Docker container
- Fetch web pages
- Search the web (using the Brave API)
- Set the name of the current trajectory

## Development

```sh
npm install
cp .env.example .env   # add your OpenRouter and Brave Search API keys
npm run dev            # tsx watch, http://127.0.0.1:3000
```

- `npm run build && npm start` — compiled production run
- `npm run lint` — eslint
- `npm test` — unit tests
- `npm run format` — prettier

Repositories and trajectories are stored in SQLite at
`DATA_DIR/app.db` (`data/app.db` by default).

## Security

Each session gets a Docker container to work inside, with a memory
limit and disk storage limit. Its only external permissions are the
GitHub token provided

I run this on a VM that isn't running anything else, using a separate
GitHub account.
