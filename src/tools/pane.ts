import { z } from "zod";
import {
  type ToolDef,
  readSourceSchema,
  waitSourceSchema,
  flag,
  boolFlag,
  normalizeKey,
} from "./types.js";

export const paneTools: ToolDef[] = [
  {
    name: "herdr_pane_list",
    description: "List panes, optionally filtered to a workspace.",
    inputSchema: {
      workspace: z.string().optional().describe("Workspace id filter."),
    },
    buildArgs: (a) => {
      const argv = ["pane", "list"];
      flag(argv, "--workspace", a.workspace);
      return argv;
    },
  },
  {
    name: "herdr_pane_get",
    description: "Get details for a pane.",
    inputSchema: { pane_id: z.string() },
    buildArgs: (a) => ["pane", "get", String(a.pane_id)],
  },
  {
    name: "herdr_pane_read",
    description:
      "Read a pane's terminal output. Keep `lines` small to avoid flooding context.",
    inputSchema: {
      pane_id: z.string(),
      source: readSourceSchema,
      lines: z.number().int().positive().max(2000).optional(),
    },
    buildArgs: (a) => {
      const argv = ["pane", "read", String(a.pane_id)];
      flag(argv, "--source", a.source);
      flag(argv, "--lines", a.lines ?? 200);
      argv.push("--format", "text");
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
      source: waitSourceSchema,
      lines: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Restrict the searched snapshot to this many lines."),
      timeout_ms: z.number().int().positive().optional(),
      raw: z
        .boolean()
        .optional()
        .describe("Keep ANSI escape sequences while matching."),
    },
    timeoutMs: 120_000,
    buildArgs: (a) => {
      const argv = ["pane", "wait-output", String(a.pane_id)];
      if (a.regex) argv.push("--regex", String(a.match));
      else argv.push("--match", String(a.match));
      flag(argv, "--source", a.source);
      flag(argv, "--lines", a.lines);
      flag(argv, "--timeout", a.timeout_ms);
      boolFlag(argv, "--raw", undefined, a.raw);
      return argv;
    },
  },
  {
    name: "herdr_pane_split",
    description: "Split a pane to create a new one (direction right or down).",
    inputSchema: {
      pane_id: z.string(),
      direction: z.enum(["right", "down"]),
      cwd: z.string().optional(),
      focus: z.boolean().optional(),
    },
    buildArgs: (a) => {
      const argv = ["pane", "split", String(a.pane_id), "--direction", String(a.direction)];
      flag(argv, "--cwd", a.cwd);
      boolFlag(argv, "--focus", "--no-focus", a.focus);
      return argv;
    },
  },
  {
    name: "herdr_pane_run",
    description:
      "Run a command in a pane: writes the command text AND presses Enter. Use this (not herdr_agent_send) when you want to execute a shell command.",
    inputSchema: {
      pane_id: z.string(),
      command: z.string().describe("Command to type and submit."),
    },
    buildArgs: (a) => ["pane", "run", String(a.pane_id), String(a.command)],
  },
  {
    name: "herdr_pane_send_text",
    description: "Send literal text to a pane without pressing Enter.",
    inputSchema: { pane_id: z.string(), text: z.string() },
    buildArgs: (a) => ["pane", "send-text", String(a.pane_id), String(a.text)],
  },
  {
    name: "herdr_pane_send_keys",
    description:
      "Send one or more key names to a pane. Valid names include `enter`, `esc`, `tab`, `ctrl+c`, `up`, `down`, `left`, `right`. Modifier forms like `ctrl-c` are normalized automatically.",
    inputSchema: {
      pane_id: z.string(),
      keys: z.array(z.string()).min(1).describe("Key names to send in order."),
    },
    buildArgs: (a) => [
      "pane",
      "send-keys",
      String(a.pane_id),
      ...(a.keys as string[]).map(normalizeKey),
    ],
  },
  {
    name: "herdr_pane_close",
    description: "Close a pane.",
    inputSchema: { pane_id: z.string() },
    buildArgs: (a) => ["pane", "close", String(a.pane_id)],
  },
  {
    name: "herdr_pane_rename",
    description: "Rename a pane label (or clear with clear=true).",
    inputSchema: {
      pane_id: z.string(),
      label: z.string().optional(),
      clear: z.boolean().optional(),
    },
    buildArgs: (a) => {
      const argv = ["pane", "rename", String(a.pane_id)];
      if (a.clear) argv.push("--clear");
      else argv.push(String(a.label));
      return argv;
    },
  },
];
