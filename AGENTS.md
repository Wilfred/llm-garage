## Repository

Always do your work in a git worktree so you don't dirty the current
checkout.

## UI Style

Keep the interface minimal and information dense. Choose designs that
work on both desktop and mobile screens.

Make form fields self-explanatory through their content, placeholder,
and accessible name. Do not add visible labels that merely repeat an
obvious field meaning.

## Pull Requests

For implementation work, take ownership of delivery: commit the changes,
push the branch, and open a pull request once validation passes unless the
user asks you not to. If a pull request already exists, update it instead of
creating another one.

## Commit Style

A single short line in the imperative is the whole commit message
almost every time. Say what changed, not why it is an improvement.

Add a body only for something the diff cannot show, such as a
constraint that forced the approach. Don't restate the diff, don't
argue for the change, and don't list the checks you ran unless they
differ from what CI runs.

Never use Markdown headings or bullet lists, and that includes bold
labels like **Changes made:** acting as a heading. Needing any of them
means the message is too long: cut it down to sentences.

Pull request descriptions follow the same rules, in a sentence or two
of plain prose. Don't enumerate the changed files; the diff is right
there.

## Naming

The product is called "LLM Garage". Use that spelling in all
user-facing text. `llm-garage` is only the repository, package and
Docker image name.
