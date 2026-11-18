import { z } from "zod";
import { runHerdr } from "../herdr.js";
import { setTimeout as sleep } from "node:timers/promises";
import { targetSchema, statusEnum, readSourceSchema, flag, boolFlag, ok, formatResult, normalizeKey, extractPaneId, resolvePaneId, } from "./types.js";
const AGENT_KINDS = [
    "pi",
    "claude",
    "codex",
    "gemini",
    "cursor",
    "devin",
    "agy",
    "cline",
    "omp",
    "mastracode",
    "opencode",
    "copilot",
    "kimi",
    "kiro",
    "droid",
    "amp",
    "grok",
    "hermes",
    "kilo",
    "qodercli",
    "qwen",
    "letta",
    "maki",
    "muse",
];
const START_ATTEMPTS = 5;
const START_RETRY_DELAY_MS = 500;
function errorMessage(err) {
    return err instanceof Error ? err.message : String(err);
}
/** Startup failures caused by the new pane's shell not being ready yet. */
function isPaneStartupError(err) {
    return /agent_pane_not_found|agent_pane_unavailable|agent_start_input_failed|not at (?:its )?(?:interactive )?shell prompt/i.test(errorMessage(err));
}
function isAgentNotReady(err) {
    return /agent_not_ready/.test(errorMessage(err));
}
/** Read an id from a documented herdr result shape, e.g. result.tab.tab_id. */
function resultId(json, section, field) {
    const result = json && typeof json === "object"
        ? json.result
        : undefined;
    const value = result?.[section];
    if (!value || typeof value !== "object")
        return undefined;
    const id = value[field];
    return typeof id === "string" ? id : undefined;
}
/** Best-effort cleanup of a workspace/tab/pane created by agent_start. */
async function cleanupCreated(created) {
    if (!created)
        return;
    try {
        if (created.kind === "workspace") {
            await runHerdr(["workspace", "close", created.id]);
        }
        else if (created.kind === "tab") {
            await runHerdr(["tab", "close", created.id]);
        }
        else {
            await runHerdr(["pane", "close", created.id]);
        }
    }
    catch {
        /* cleanup is best effort; keep the original error */
    }
}
async function startAgent(name, kind, paneId, extraArgs, timeoutMs, ctx) {
    const argv = ["agent", "start", name, "--kind", kind, "--pane", paneId];
    flag(argv, "--timeout", timeoutMs);
    if (Array.isArray(extraArgs) && extraArgs.length > 0) {
        argv.push("--", ...extraArgs);
    }
    for (let attempt = 1; attempt <= START_ATTEMPTS; attempt++) {
        try {
            const result = await runHerdr(argv, { timeoutMs: ctx.timeoutMs });
            return { ok: true, text: formatResult(result) };
        }
        catch (err) {
            if (isPaneStartupError(err) && attempt < START_ATTEMPTS) {
                await sleep(START_RETRY_DELAY_MS);
                continue;
            }
            return { ok: false, error: err };
        }
    }
    return { ok: false, error: new Error("agent start failed") };
}
export const agentTools = [
    {
        name: "herdr_agent_list",
        description: "List all agents herdr currently recognizes — any supported agent type (pi, omp, claude, codex, opencode, hermes, qodercli, …) — with semantic state (idle/working/blocked/done), cwd, pane/tab/workspace ids. Use this first to discover targets for other agent tools.",
        inputSchema: {},
        buildArgs: () => ["agent", "list"],
    },
    {
        name: "herdr_agent_get",
        description: "Get details for a single agent (state, pane id, workspace, agent session).",
        inputSchema: { target: targetSchema },
        buildArgs: (a) => ["agent", "get", String(a.target)],
    },
    {
        name: "herdr_agent_read",
        description: "Read another agent's terminal output to gather context (contextual handoff). Defaults to the visible screen, which is the most reliable source. Keep `lines` small to avoid flooding context. To find valid targets first, call `herdr_agent_list`.",
        inputSchema: {
            target: targetSchema,
            source: readSourceSchema.describe("Which portion of the agent pane buffer to read (default: visible)."),
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
        description: "Low-level: write literal text to an agent WITHOUT pressing Enter (the text is typed but not submitted). For normal agent-to-agent messaging prefer `herdr_relay` (prompt + submit) or `herdr_handoff` (send + wait + read). First call `herdr_agent_list` if you're unsure of the target.",
        inputSchema: {
            target: targetSchema,
            text: z.string().describe("Literal text to deliver to the agent."),
        },
        run: async (a) => {
            const target = String(a.target);
            const paneId = await resolvePaneId(target);
            await runHerdr(["pane", "send-text", paneId, String(a.text)]);
            return ok(`Typed text to "${target}" (not submitted).`);
        },
    },
    {
        name: "herdr_agent_send_keys",
        description: "Send key presses to an agent (e.g. 'enter', 'esc', 'tab', 'ctrl+c', 'up'). Keys are normalized to herdr's canonical names.",
        inputSchema: {
            target: targetSchema,
            keys: z.array(z.string()).min(1).describe("Key names to send in order."),
        },
        buildArgs: (a) => [
            "agent",
            "send-keys",
            String(a.target),
            ...a.keys.map(normalizeKey),
        ],
    },
    {
        name: "herdr_agent_prompt",
        description: "Submit a prompt to an agent (types the text and presses Enter). With `wait`, block until the first matching state is observed after submission; `until` and `timeout_ms` also imply `wait`. Failures include `agent_blocked` (the agent was already blocked; no input was sent), `agent_prompt_stalled` (no working/blocked state was observed within 5s), and `timeout` (the caller timeout expired).",
        inputSchema: {
            target: targetSchema,
            text: z.string().describe("Prompt text to submit."),
            wait: z
                .boolean()
                .optional()
                .describe("Wait for a matching state after submission."),
            until: z
                .union([statusEnum, z.array(statusEnum)])
                .optional()
                .describe("State(s) to match with `wait`; repeatable. Default: idle, done or blocked."),
            timeout_ms: z
                .number()
                .int()
                .positive()
                .optional()
                .describe("Max time to wait in milliseconds."),
        },
        timeoutMs: 120_000,
        buildArgs: (a) => {
            const argv = ["agent", "prompt", String(a.target), String(a.text)];
            // herdr 0.9.5 rejects --until/--timeout unless --wait is present.
            const wait = a.wait === true || a.until !== undefined || a.timeout_ms !== undefined;
            boolFlag(argv, "--wait", undefined, wait);
            const until = a.until;
            for (const status of Array.isArray(until) ? until : until ? [until] : []) {
                argv.push("--until", status);
            }
            flag(argv, "--timeout", a.timeout_ms);
            return argv;
        },
    },
    {
        name: "herdr_agent_wait",
        description: "Block until an agent reaches a status. With no status/until, herdr waits for idle, done or blocked. Use `until` (repeatable via an array) to match exact states; the legacy `status` input is still accepted and `until` wins when both are given.",
        inputSchema: {
            target: targetSchema,
            until: z
                .union([statusEnum, z.array(statusEnum)])
                .optional()
                .describe("State(s) to wait for; arrays emit one --until per value."),
            status: z
                .union([statusEnum, z.array(statusEnum)])
                .optional()
                .describe("Legacy status (single or array; use `until` instead)."),
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
            const until = (a.until ?? a.status);
            for (const status of Array.isArray(until) ? until : until ? [until] : []) {
                argv.push("--until", status);
            }
            flag(argv, "--timeout", a.timeout_ms);
            return argv;
        },
    },
    {
        name: "herdr_agent_start",
        description: "Start a supported agent in an existing pane. Creates a workspace, tab or pane first unless `pane_id` is given. The pane must be at an interactive shell prompt; startup retries briefly while the new shell initializes. Returns `agent_not_ready` as a normal result if the agent is blocked during startup — the name is still usable with herdr_agent_read and herdr_agent_send_keys.",
        inputSchema: {
            name: z
                .string()
                .regex(/^[a-z][a-z0-9_-]{0,31}$/)
                .describe("Live agent name (unique, [a-z][a-z0-9_-]{0,31})."),
            kind: z.enum(AGENT_KINDS).describe("Supported agent kind."),
            args: z
                .array(z.string())
                .optional()
                .describe("Extra arguments passed to the agent command after '--'."),
            pane_id: z
                .string()
                .optional()
                .describe("Existing shell pane at its prompt (skips creation)."),
            workspace: z
                .string()
                .optional()
                .describe("Workspace id in which to create a new tab."),
            split_from: z
                .string()
                .optional()
                .describe("Pane id to split, creating the new pane for the agent."),
            direction: z
                .enum(["right", "down"])
                .optional()
                .describe("Split direction when using `split_from` (default: right)."),
            split: z
                .enum(["right", "down"])
                .optional()
                .describe("Legacy: split the current pane in this direction."),
            cwd: z.string().optional().describe("Working directory for the new agent."),
            focus: z
                .boolean()
                .optional()
                .describe("Focus the new agent afterwards (default: false)."),
            timeout_ms: z
                .number()
                .int()
                .positive()
                .optional()
                .describe("Wait for interactive readiness (herdr default 30000, max 300000)."),
        },
        timeoutMs: 120_000,
        run: async (a, ctx) => {
            const name = String(a.name);
            const kind = String(a.kind);
            const extraArgs = Array.isArray(a.args) ? a.args : undefined;
            const startTimeout = typeof a.timeout_ms === "number" ? a.timeout_ms : undefined;
            let paneId;
            let created;
            if (a.pane_id) {
                paneId = String(a.pane_id);
            }
            else if (a.split_from) {
                const argv = [
                    "pane",
                    "split",
                    String(a.split_from),
                    "--direction",
                    String(a.direction ?? "right"),
                ];
                flag(argv, "--cwd", a.cwd);
                argv.push("--no-focus");
                const result = await runHerdr(argv, { timeoutMs: ctx.timeoutMs });
                const id = extractPaneId(result.json);
                if (!id)
                    throw new Error("herdr pane split did not return a pane id");
                paneId = id;
                created = { kind: "pane", id };
            }
            else if (a.split) {
                const argv = [
                    "pane",
                    "split",
                    "--current",
                    "--direction",
                    String(a.split),
                ];
                flag(argv, "--cwd", a.cwd);
                argv.push("--no-focus");
                let result;
                try {
                    result = await runHerdr(argv, { timeoutMs: ctx.timeoutMs });
                }
                catch (err) {
                    throw new Error(`could not split the current pane (${errorMessage(err)}). ` +
                        "Pass `pane_id` or `split_from` when the MCP server is not running inside a herdr pane.");
                }
                const id = extractPaneId(result.json);
                if (!id)
                    throw new Error("herdr pane split did not return a pane id");
                paneId = id;
                created = { kind: "pane", id };
            }
            else if (a.workspace) {
                const argv = ["tab", "create", "--workspace", String(a.workspace)];
                flag(argv, "--cwd", a.cwd);
                flag(argv, "--label", name);
                argv.push("--no-focus");
                const result = await runHerdr(argv, { timeoutMs: ctx.timeoutMs });
                const tabId = resultId(result.json, "tab", "tab_id");
                const id = extractPaneId(result.json);
                if (!id) {
                    await cleanupCreated(tabId ? { kind: "tab", id: tabId } : undefined);
                    throw new Error("herdr tab create did not return a pane id");
                }
                paneId = id;
                created = tabId
                    ? { kind: "tab", id: tabId }
                    : { kind: "pane", id };
            }
            else {
                const argv = ["workspace", "create"];
                flag(argv, "--cwd", a.cwd);
                flag(argv, "--label", name);
                argv.push("--no-focus");
                const result = await runHerdr(argv, { timeoutMs: ctx.timeoutMs });
                const workspaceId = resultId(result.json, "workspace", "workspace_id");
                const id = extractPaneId(result.json);
                if (!id) {
                    await cleanupCreated(workspaceId ? { kind: "workspace", id: workspaceId } : undefined);
                    throw new Error("herdr workspace create did not return a pane id");
                }
                paneId = id;
                created = workspaceId
                    ? { kind: "workspace", id: workspaceId }
                    : { kind: "pane", id };
            }
            const started = await startAgent(name, kind, paneId, extraArgs, startTimeout, ctx);
            if (!started.ok) {
                if (isAgentNotReady(started.error)) {
                    return ok(`Agent "${name}" started but is blocked during startup (agent_not_ready). ` +
                        "The name is available: use herdr_agent_read and herdr_agent_send_keys, " +
                        "and wait until it becomes idle before prompting.\n\n" +
                        errorMessage(started.error));
                }
                await cleanupCreated(created);
                throw started.error;
            }
            if (a.focus === true) {
                await runHerdr(["agent", "focus", name], { timeoutMs: ctx.timeoutMs });
            }
            return ok(started.text);
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
            if (a.clear)
                argv.push("--clear");
            else
                argv.push(String(a.name));
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
//# sourceMappingURL=agent.js.map