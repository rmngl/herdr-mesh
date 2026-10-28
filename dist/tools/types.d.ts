import { z, type ZodRawShape } from "zod";
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
    run?: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
    /** Optional per-tool timeout (ms); falls back to runHerdr default. */
    timeoutMs?: number;
}
export interface ToolResult {
    [key: string]: unknown;
    content: Array<{
        type: "text";
        text: string;
    }>;
    isError?: boolean;
}
/** Wrap arbitrary text as a successful tool result. */
export declare function ok(text: string): ToolResult;
/** Format a herdr result (parsed JSON if available, else raw stdout). */
export declare function formatResult(result: {
    json?: unknown;
    stdout: string;
}): string;
/** Execute a ToolDef: run custom handler, or build argv + run herdr. */
export declare function execTool(tool: ToolDef, args: Record<string, unknown>): Promise<ToolResult>;
/** Common reusable schema fragments. */
export declare const targetSchema: z.ZodString;
export declare const statusEnum: z.ZodEnum<["idle", "working", "blocked", "done", "unknown"]>;
export declare const readSourceSchema: z.ZodOptional<z.ZodEnum<["visible", "recent", "recent-unwrapped", "detection"]>>;
export declare const waitSourceSchema: z.ZodOptional<z.ZodEnum<["visible", "recent", "recent-unwrapped"]>>;
/** Append `--flag value` when value is defined. */
export declare function flag(argv: string[], name: string, value: unknown): void;
/** Append a boolean `--flag` / `--no-flag` pair when defined. */
export declare function boolFlag(argv: string[], onFlag: string, offFlag: string | undefined, value: unknown): void;
/**
 * Normalize a key name to herdr 0.9.5's canonical form.
 * `Ctrl-Shift-C` → `ctrl+shift+C`, `escape` → `esc`; unknown forms pass through.
 */
export declare function normalizeKey(key: string): string;
/** Pull the pane id out of a herdr response using the documented shapes. */
export declare function extractPaneId(json: unknown): string | undefined;
/**
 * Resolve an agent target to the pane hosting it.
 * Tries `agent get` first, then `pane get` so a raw pane id also works.
 */
export declare function resolvePaneId(target: string): Promise<string>;
