# DESIGN

Why herdr-mesh is shaped the way it is, and which claims behind that shape have
actually been checked.

## Position

herdr exposes 103 JSON API methods over a Unix socket plus a matching CLI. Several
other herdr MCP servers mirror that surface one-to-one — 92 tools, one per method.
That is the worst available answer for context economy: every tool definition is
rent paid on every request, before the model has read a single result.

herdr-mesh takes the other position. A curated surface, sized to what an
orchestrating agent actually does: discover siblings, hand work over, wait for it,
read the result back. Tools are added when supervision needs them, not for parity.

The consumer is a coding agent running *inside* a herdr pane, coordinating its
siblings — not a human, and not a remote client driving herdr from elsewhere.

## Verified findings

Checked against herdr 0.9.0 and a live multi-agent session. Recorded here because
each one cost something to learn.

### The CLI help text is incomplete

`herdr --help` and the per-group summaries omit real commands: `pane run` exists
but is absent from `herdr pane` output. Confirm a command by running it with no
arguments — a usage line means it exists, falling back to the group listing means
it does not. This is the single most useful habit when working on this project;
the alternative is silent drift as herdr evolves.

### Detection beats the viewport for agent state

`agent read --source visible` returns whatever is in the user's viewport, so a
human scrolling the target pane changes what an agent reads. `--source detection`
is the bottom-buffer slice herdr's own detector inspects and is scroll-independent.
herdr's own guidance is explicit that the visible viewport must not be used for
agent status for this reason.

### `idle` and `done` both mean ready

They differ only in whether the server considers the completion *seen* — focus
marks an agent seen, reads do not. Waiting on `idle` alone can therefore hang for
a full timeout against an agent that finished and reported `done`. `--until` is
repeatable, so waiting on both is one flag rather than a retry loop.

### Detection cannot tell you what an agent is asking

A matched detection rule carries an id, a priority, a region and a state — but no
captured text. So `blocked` is a reliable boolean, while the question being asked
and its options are not available, and recovering them would mean building a
second detection system. Worth knowing before designing any triage feature.

### Transcripts are cheaper and truer than screens

Where an agent integration is installed, herdr receives the agent's on-disk
session path and stores it for resume. Measured on a live session, reading a
sibling agent:

| Source | Cost | Fidelity |
|---|---|---|
| Viewport read | ~723 tokens | clipped mid-sentence, plus UI chrome |
| Session transcript | ~382 tokens | the complete assistant turn, clean prose |

The fidelity difference matters more than the token difference: the transcript
returns the whole message, the screen returns whatever fits in the pane. Note the
dependency — integrations are not installed by default, and the path cannot be
safely guessed from the pane's working directory, because two agents working in
one repository share a project directory.

### Cursors are mostly unavailable

Three different revision counters are easy to conflate, and the one returned by
`pane read` is hardcoded to zero. Treat resumable output cursors as unavailable
for now rather than building on them.

## Constraints

These encode how herdr itself behaves, and hold regardless of what a caller asks.

- **Never auto-answer an approval prompt.** herdr refuses to prompt a `blocked`
  agent on purpose — approval is a trust decision. Surface it to a human.
- **A stall does not prove nothing was sent.** After `agent_prompt_stalled` or a
  timeout, read before retrying; re-prompting can hand the same task over twice.
- **Never move the human's focus** unless the caller explicitly asked for it.
- **Pane ids are not stable.** A pane moved across workspaces is issued a new id.
  Resolve immediately before use; never cache one.
- **Bound every read.** No tool should return unbounded text, and truncation
  should always be visible to the caller.

## Possible directions

Not built. Recorded so the shape of the project stays legible.

- A projected, diffable fleet roll-up. `agent.list` returns roughly a dozen fields
  per agent unconditionally; a supervisor needs about six, and the difference
  compounds with pane count.
- A multiplexed wait returning the first agent that needs attention, rather than
  one blocking call per agent.
- Reading structured turns from the session transcript, with the screen as fallback.
- Worktree fan-out and fan-in, for running variants in parallel and comparing them.

The first two want a persistent socket connection for `events.subscribe`, which
the current CLI shell-out transport cannot provide. Design new code so the
transport can be swapped underneath.
