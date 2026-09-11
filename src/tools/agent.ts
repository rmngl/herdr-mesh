import { z } from "zod";
import {
  type ToolDef,
  type ToolResult,
  agentStatusSchema,
  toStatusList,
  targetSchema,
  sourceSchema,
  flag,
  ok,
  formatResult,
} from "./types.js";
import { runHerdr } from "../herdr.js";
import { resolvePaneId } from "./resolve.js";

export const agentTools: ToolDef[] = [
  {
    name: "herdr_agent_list",
    description:
      "List all agents herdr currently recognizes — any supported agent type (pi, omp, claude, codex, opencode, hermes, qodercli, …) — with semantic state (idle/working/blocked/done), cwd, pane/tab/workspace ids. Use this first to discover targets for other agent tools.",
    inputSchema: {},
    buildArgs: () => ["agent", "list"],
  },
  {
    name: "herdr_agent_get",
    description:
      "Get details for a single agent (state, pane id, workspace, agent session).",
    inputSchema: { target: targetSchema },
    buildArgs: (a) => ["agent", "get", String(a.target)],
  },
  {
    name: "herdr_agent_read",
    description:
      "Read another agent's terminal output to gather context (contextual handoff). Defaults to the visible screen, which is the most reliable source. Keep `lines` small to avoid flooding context. To find valid targets first, call `herdr_agent_list`.",
    inputSchema: {
      target: targetSchema,
      source: sourceSchema,
      lines: z
        .number()
        .int()
        .positive()
        .max(2000)
        .optional()
        .describe("Number of trailing lines to read (default 200)."),
    },
    buildArgs: (a) => {
      const argv = ["agent", "read", String(a.target)];
      flag(argv, "--source", a.source ?? "visible");
      flag(argv, "--lines", a.lines ?? 200);
      argv.push("--format", "text");
      return argv;
    },
  },
  {
    name: "herdr_agent_send",
    description:
      "Low-level: write literal text to an agent WITHOUT pressing Enter (the text is typed but not submitted). For normal agent-to-agent messaging prefer `herdr_relay` (types + Enter) or `herdr_handoff` (send + wait + read). First call `herdr_agent_list` if you're unsure of the target.",
    inputSchema: {
      target: targetSchema,
      text: z.string().describe("Literal text to deliver to the agent."),
    },
    // herdr has no `agent send`; typing without submitting is a pane-level
    // operation, so resolve the agent's pane first.
    run: async (a): Promise<ToolResult> => {
      const paneId = await resolvePaneId(String(a.target));
      const res = await runHerdr(["pane", "send-text", paneId, String(a.text)]);
      return ok(formatResult(res));
    },
  },
  {
    name: "herdr_agent_wait",
    description:
      "Block until an agent reaches one of the given statuses. Useful to synchronize a handoff (wait for the other agent to become idle/done before sending the next step). Note that `idle` and `done` both mean the agent is ready for input.",
    inputSchema: {
      target: targetSchema,
      status: z
        .union([agentStatusSchema, z.array(agentStatusSchema).min(1)])
        .describe("Status (or statuses) to wait for; the first to occur wins."),
      timeout_ms: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Max time to wait in milliseconds."),
    },
    // Allow the subprocess to outlive the requested CLI timeout.
    timeoutMs: 120_000,
    buildArgs: (a) => {
      const argv = ["agent", "wait", String(a.target)];
      // `--until` is repeatable and replaced `--status` in herdr 0.9.
      for (const s of toStatusList(a.status)) argv.push("--until", s);
      flag(argv, "--timeout", a.timeout_ms);
      return argv;
    },
  },
  {
    name: "herdr_wait_output",
    description:
      "Block until a pane's output matches given text (or regex). Useful to wait for a build/command to finish in another agent's pane.",
    inputSchema: {
      pane_id: z.string().describe("Pane id to watch."),
      match: z.string().describe("Text (or regex if `regex` is true) to wait for."),
      regex: z.boolean().optional().describe("Treat `match` as a regex."),
      source: sourceSchema,
      lines: z.number().int().positive().max(2000).optional(),
      timeout_ms: z.number().int().positive().optional(),
    },
    timeoutMs: 120_000,
    buildArgs: (a) => {
      // herdr 0.9: `pane wait-output`; --match and --regex are alternatives
      // rather than a boolean modifying --match.
      const argv = ["pane", "wait-output", String(a.pane_id)];
      argv.push(a.regex ? "--regex" : "--match", String(a.match));
      flag(argv, "--source", a.source);
      flag(argv, "--lines", a.lines);
      flag(argv, "--timeout", a.timeout_ms);
      return argv;
    },
  },
  {
    name: "herdr_agent_start",
    description:
      "Start a recognized agent in an EXISTING, idle shell pane. `agent start` never creates, splits or moves layout — call `herdr_pane_split` (or create a tab/workspace) first and pass the resulting pane_id here. Blocks until herdr detects the agent and it is ready.",
    inputSchema: {
      name: z
        .string()
        .regex(/^[a-z][a-z0-9_-]{0,31}$/)
        .describe(
          "Live agent name, unique among running agents: [a-z][a-z0-9_-]{0,31}.",
        ),
      kind: z
        .string()
        .describe(
          "Agent kind herdr knows how to launch, e.g. claude, codex, gemini, cursor, opencode, copilot, amp, grok, qwen.",
        ),
      pane_id: z
        .string()
        .describe("Existing pane to start the agent in. The pane must be an idle shell."),
      args: z
        .array(z.string())
        .optional()
        .describe("Extra arguments passed through to the agent binary."),
      timeout_ms: z
        .number()
        .int()
        .min(3001)
        .max(300_000)
        .optional()
        .describe("Startup timeout in ms (herdr requires >3000 and <=300000)."),
    },
    timeoutMs: 120_000,
    buildArgs: (a) => {
      // herdr 0.9: `agent start <name> --kind KIND --pane ID [--timeout MS] [-- args]`
      const argv = ["agent", "start", String(a.name)];
      flag(argv, "--kind", a.kind);
      flag(argv, "--pane", a.pane_id);
      flag(argv, "--timeout", a.timeout_ms);
      const extra = (a.args as string[] | undefined) ?? [];
      if (extra.length > 0) argv.push("--", ...extra);
      return argv;
    },
  },
  {
    name: "herdr_agent_rename",
    description: "Rename an agent (or clear its name with clear=true).",
    inputSchema: {
      target: targetSchema,
      name: z.string().optional().describe("New name. Omit and set clear=true to clear."),
      clear: z.boolean().optional(),
    },
    buildArgs: (a) => {
      const argv = ["agent", "rename", String(a.target)];
      if (a.clear) argv.push("--clear");
      else argv.push(String(a.name));
      return argv;
    },
  },
  {
    name: "herdr_agent_focus",
    description: "Focus an agent's pane in the herdr UI.",
    inputSchema: { target: targetSchema },
    buildArgs: (a) => ["agent", "focus", String(a.target)],
  },
];
