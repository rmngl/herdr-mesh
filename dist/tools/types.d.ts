import { z, type ZodRawShape } from "zod";
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
export declare const sourceSchema: z.ZodOptional<z.ZodEnum<["visible", "recent", "recent-unwrapped"]>>;
/** herdr's semantic agent lifecycle states. */
export declare const agentStatusSchema: z.ZodEnum<["idle", "working", "blocked", "done", "unknown"]>;
/** Normalize a single status or a list into a list, for repeatable `--until`. */
export declare function toStatusList(value: unknown): string[];
/** Append `--flag value` when value is defined. */
export declare function flag(argv: string[], name: string, value: unknown): void;
/** Append a boolean `--flag` / `--no-flag` pair when defined. */
export declare function boolFlag(argv: string[], onFlag: string, offFlag: string | undefined, value: unknown): void;
