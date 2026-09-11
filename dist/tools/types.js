import { z } from "zod";
import { runHerdr, HerdrError } from "../herdr.js";
/** Wrap arbitrary text as a successful tool result. */
export function ok(text) {
    return { content: [{ type: "text", text: text || "(no output)" }] };
}
/** Format a herdr result (parsed JSON if available, else raw stdout). */
export function formatResult(result) {
    return result.json !== undefined
        ? JSON.stringify(result.json, null, 2)
        : result.stdout.trim() || "(no output)";
}
/** Execute a ToolDef: run custom handler, or build argv + run herdr. */
export async function execTool(tool, args) {
    try {
        if (tool.run)
            return await tool.run(args);
        const argv = tool.buildArgs(args);
        const result = await runHerdr(argv, { timeoutMs: tool.timeoutMs });
        return ok(formatResult(result));
    }
    catch (err) {
        const message = err instanceof HerdrError ? err.message : String(err);
        return { content: [{ type: "text", text: message }], isError: true };
    }
}
/** Common reusable schema fragments. */
export const targetSchema = z
    .string()
    .describe("Agent target: terminal id, unique agent name, detected/reported agent label, or legacy pane id.");
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
export function toStatusList(value) {
    if (Array.isArray(value))
        return value.map(String);
    if (value === undefined || value === null || value === "")
        return [];
    return [String(value)];
}
/** Append `--flag value` when value is defined. */
export function flag(argv, name, value) {
    if (value !== undefined && value !== null && value !== "") {
        argv.push(name, String(value));
    }
}
/** Append a boolean `--flag` / `--no-flag` pair when defined. */
export function boolFlag(argv, onFlag, offFlag, value) {
    if (value === true)
        argv.push(onFlag);
    else if (value === false && offFlag)
        argv.push(offFlag);
}
//# sourceMappingURL=types.js.map