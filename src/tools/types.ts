import { z, type ZodRawShape } from "zod";
import { runHerdr, HerdrError } from "../herdr.js";

export interface ToolContext {
  /** Subprocess timeout in ms, derived from the tool and `timeout_ms` input. */
  timeoutMs?: number;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: ZodRawShape;
  /** Build the herdr CLI argv from validated args (single-command tools). */
  buildArgs?: (args: Record<string, unknown>) => string[];
  /** Custom multi-step handler (composite tools). Takes precedence over buildArgs. */
  run?: (
    args: Record<string, unknown>,
    ctx: ToolContext,
  ) => Promise<ToolResult>;
  /** Optional per-tool timeout (ms); falls back to runHerdr default. */
  timeoutMs?: number;
}

export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

/** Wrap arbitrary text as a successful tool result. */
export function ok(text: string): ToolResult {
  return { content: [{ type: "text", text: text || "(no output)" }] };
}

/** Format a herdr result (parsed JSON if available, else raw stdout). */
export function formatResult(result: { json?: unknown; stdout: string }): string {
  return result.json !== undefined
    ? JSON.stringify(result.json, null, 2)
    : result.stdout.trim() || "(no output)";
}

/** Execute a ToolDef: run custom handler, or build argv + run herdr. */
export async function execTool(
  tool: ToolDef,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    // Let the subprocess outlive the CLI's own timeout so herdr can report
    // a clean command-level error instead of being killed by our wrapper.
    const requested = args.timeout_ms;
    const timeoutMs =
      typeof requested === "number"
        ? Math.max(tool.timeoutMs ?? 30_000, requested + 10_000)
        : tool.timeoutMs;

    if (tool.run) return await tool.run(args, { timeoutMs });
    const argv = tool.buildArgs!(args);
    const result = await runHerdr(argv, { timeoutMs });
    return ok(formatResult(result));
  } catch (err) {
    const message = err instanceof HerdrError ? err.message : String(err);
    return { content: [{ type: "text", text: message }], isError: true };
  }
}

/** Common reusable schema fragments. */
export const targetSchema = z
  .string()
  .describe(
    "Live agent name (unique, `[a-z][a-z0-9_-]{0,31}`) or the pane id hosting the agent. Terminal ids and agent-kind labels are not accepted.",
  );

export const statusEnum = z.enum([
  "idle",
  "working",
  "blocked",
  "done",
  "unknown",
]);

export const readSourceSchema = z
  .enum(["visible", "recent", "recent-unwrapped", "detection"])
  .optional()
  .describe("Which portion of the pane buffer to read (default: recent).");

export const waitSourceSchema = z
  .enum(["visible", "recent", "recent-unwrapped"])
  .optional()
  .describe("Which portion of the pane buffer to search (default: recent).");

/** Append `--flag value` when value is defined. */
export function flag(
  argv: string[],
  name: string,
  value: unknown,
): void {
  if (value !== undefined && value !== null && value !== "") {
    argv.push(name, String(value));
  }
}

/** Append a boolean `--flag` / `--no-flag` pair when defined. */
export function boolFlag(
  argv: string[],
  onFlag: string,
  offFlag: string | undefined,
  value: unknown,
): void {
  if (value === true) argv.push(onFlag);
  else if (value === false && offFlag) argv.push(offFlag);
}

/**
 * Normalize a key name to herdr 0.9.5's canonical form.
 * `Ctrl-Shift-C` → `ctrl+shift+C`, `escape` → `esc`; unknown forms pass through.
 */
export function normalizeKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.toLowerCase() === "escape") return "esc";
  const match = /^((?:(?:ctrl|alt|shift|meta|super)-)+)([^-]+)$/i.exec(trimmed);
  if (!match) return trimmed;
  const modifiers = match[1]
    .slice(0, -1)
    .split("-")
    .map((part) => part.toLowerCase());
  return [...modifiers, match[2]].join("+");
}

/** Pull the pane id out of a herdr response using the documented shapes. */
export function extractPaneId(json: unknown): string | undefined {
  const result =
    json && typeof json === "object"
      ? (json as { result?: Record<string, unknown> }).result
      : undefined;
  const paneIdOf = (value: unknown): string | undefined => {
    if (!value || typeof value !== "object") return undefined;
    const id = (value as Record<string, unknown>).pane_id;
    return typeof id === "string" ? id : undefined;
  };
  return (
    paneIdOf(result?.agent) ??
    paneIdOf(result?.pane) ??
    paneIdOf(result?.root_pane)
  );
}

/**
 * Resolve an agent target to the pane hosting it.
 * Tries `agent get` first, then `pane get` so a raw pane id also works.
 */
export async function resolvePaneId(target: string): Promise<string> {
  for (const cmd of [["agent", "get", target], ["pane", "get", target]]) {
    try {
      const res = await runHerdr(cmd);
      const paneId = extractPaneId(res.json);
      if (paneId) return paneId;
    } catch {
      /* try next resolver */
    }
  }
  throw new Error(`could not resolve pane_id for target "${target}"`);
}
