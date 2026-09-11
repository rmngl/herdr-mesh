# herdr-mesh

An MCP server exposing [herdr](https://herdr.dev) to coding agents, so they can
read each other's context, hand work over and coordinate without a human shuffling
between terminals.

Read [DESIGN.md](./DESIGN.md) before proposing changes — it records what has been
verified against a live daemon, and why the tool surface is curated rather than a
mirror of herdr's API.

## Verify against the running daemon, never the help text

The rule that matters most here.

- `herdr --help` and the group summaries are **incomplete**: `pane run` exists but
  is unlisted. Confirm a command by running it with no arguments — a usage line
  means it exists, falling back to the group listing means it does not.
- Before changing any `buildArgs`, run the real command against a live session and
  include the result in the pull request.
- Say which herdr version a change was verified against. herdr moves quickly, and
  commands have been renamed between releases (`agent send` removed,
  `agent wait --status` → `--until`, `wait output` → `pane wait-output`).

## Architecture

- `src/herdr.ts` — runs the CLI, parses the trailing JSON line.
- `src/tools/*.ts` — one file per tool group, each exporting `ToolDef[]`.
- `src/tools/types.ts` — shared zod fragments, argv helpers, `execTool`.
- `src/tools/resolve.ts` — target → pane id. Resolve immediately before use; a pane
  moved across workspaces gets a **new** id, so never cache one.
- Tools declare either `buildArgs` (a single command) or `run` (multi-step).

`dist/` is committed so `npm i -g github:…` works without a build step. **Any commit
touching `src/` must rebuild it** (`npm run build`), or installs from GitHub ship
stale code.

Transport is CLI shell-out today. A socket transport would allow
`events.subscribe`, which anything watching many agents at once will need; write
new code so the transport can be swapped underneath.

## Context economy is the product

Every tool definition is paid for on every request, and every result again when the
model reads it. That is the reason to prefer this project over a 1:1 API mirror, so:

- Adding a tool has to be argued for. Prefer a parameter on an existing tool.
- Bound every read; never return unbounded text, and always report truncation.
- Prefer `detection` over `visible` when reasoning about agent state — the user can
  scroll the viewport, but the detection source cannot be moved by them.

## Safety

Not style preferences — these encode how herdr itself behaves.

- **Never auto-answer an approval prompt.** herdr refuses to prompt a `blocked`
  agent on purpose. Route it to a human.
- **Never re-send after a stalled wait.** `agent_prompt_stalled` or a timeout does
  not prove the text was undelivered; resending duplicates the task.
- **Never move the human's focus** unless the caller explicitly asked.
- **No destructive git** from any tool — no force-push, branch deletion or merge.
  Produce the evidence and let a human act on it.

## Conventions

- Lowercase conventional commits (`fix:`, `feat:`, `docs:`, `chore:`), no emojis.
- Explain *why* in the body; reference issues with `refs #N`.
- TypeScript strict; `npx tsc --noEmit` must pass before every commit.
- Comments record herdr behaviour you had to discover. A comment restating the code
  is noise.

## Checks

```bash
npm install
npx tsc --noEmit     # type check
npm run build        # rebuild the committed dist/
npm run dev          # run from source on stdio
```
