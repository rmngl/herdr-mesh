import { z, type ZodRawShape } from "zod";
import { runHerdr, HerdrError } from "../herdr.js";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: ZodRawShape;
  /** Build the herdr CLI argv from validated args (single-command tools). */
  buildArgs?: (args: Record<string, unknown>) => string[];
  /** Custom multi-step handler (composite tools). Takes precedence over buildArgs. */
  run?: (args: Record<string, unknown>) => Promise<ToolResult>;
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
    if (tool.run) return await tool.run(args);
    const argv = tool.buildArgs!(args);
    const result = await runHerdr(argv, { timeoutMs: tool.timeoutMs });
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
    "Agent target: terminal id, unique agent name, detected/reported agent label, or legacy pane id.",
  );

export const sourceSchema = z
  .enum(["visible", "recent", "recent-unwrapped"])
  .optional()
  .describe("Which portion of the pane buffer to read (default: visible).");

/**
 * `agent read` additionally accepts `detection` — the bottom-buffer slice herdr's
 * detector inspects. Prefer it when reasoning about agent state: the user can
 * scroll the visible viewport, but the detection source is scroll-independent.
 */
export const agentSourceSchema = z
  .enum(["visible", "recent", "recent-unwrapped", "detection"])
  .optional()
  .describe("Which portion of the pane buffer to read (default: visible).");

/** herdr's semantic agent lifecycle states. */
export const agentStatusSchema = z.enum([
  "idle",
  "working",
  "blocked",
  "done",
  "unknown",
]);

/** Normalize a single status or a list into a list, for repeatable `--until`. */
export function toStatusList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (value === undefined || value === null || value === "") return [];
  return [String(value)];
}

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
