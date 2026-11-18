import { z } from "zod";
import { runHerdr } from "../herdr.js";
import { targetSchema, statusEnum, readSourceSchema, ok, formatResult, resolvePaneId, } from "./types.js";
function untilFlags(argv, statuses) {
    const values = Array.isArray(statuses)
        ? statuses
        : statuses
            ? [statuses]
            : [];
    for (const status of values)
        argv.push("--until", String(status));
}
export const compositeTools = [
    {
        name: "herdr_relay",
        description: "Deliver a message to an agent AND submit it (types the text, then presses Enter). Use this for normal agent-to-agent messaging — it avoids the common mistake of sending text that never gets submitted. Set submit=false to type without Enter.",
        inputSchema: {
            target: targetSchema,
            text: z.string().describe("Message/prompt to deliver to the agent."),
            submit: z
                .boolean()
                .optional()
                .describe("Press Enter after typing (default true)."),
        },
        run: async (a, ctx) => {
            const target = String(a.target);
            const submit = a.submit !== false;
            if (submit) {
                await runHerdr(["agent", "prompt", target, String(a.text)], {
                    timeoutMs: ctx.timeoutMs,
                });
                return ok(`Delivered to "${target}" and submitted (Enter).`);
            }
            // Resolve pane first so a bad target fails before we type anything.
            const paneId = await resolvePaneId(target);
            await runHerdr(["pane", "send-text", paneId, String(a.text)], {
                timeoutMs: ctx.timeoutMs,
            });
            return ok(`Delivered to "${target}" (not submitted).`);
        },
    },
    {
        name: "herdr_handoff",
        description: "Hand a task to another agent and wait for its result in one step: deliver the message (with Enter), wait until the agent reaches a status (default idle, done or blocked), then read its output back. Use this for review/fix/verify handoffs so the multi-step chain can't break midway. Returns the target agent's resulting output.",
        inputSchema: {
            target: targetSchema,
            message: z.string().describe("Task/prompt to hand to the agent."),
            wait_status: statusEnum
                .optional()
                .describe("Status to wait for. Omit to use herdr's default (idle, done or blocked)."),
            timeout_ms: z
                .number()
                .int()
                .positive()
                .optional()
                .describe("Max time to wait for the status (default 120000)."),
            read_source: readSourceSchema.describe("Which portion of the pane buffer to read back (default: visible). TUI agents pad the screen, so `recent` can miss the reply."),
            read_lines: z
                .number()
                .int()
                .positive()
                .max(2000)
                .optional()
                .describe("Lines of output to read back (default 200)."),
        },
        timeoutMs: 180_000,
        run: async (a, ctx) => {
            const target = String(a.target);
            const statuses = a.wait_status;
            const timeout = a.timeout_ms ?? 120_000;
            const lines = a.read_lines ?? 200;
            const readSource = a.read_source ?? "visible";
            const argv = [
                "agent",
                "prompt",
                target,
                String(a.message),
                "--wait",
            ];
            untilFlags(argv, statuses);
            argv.push("--timeout", String(timeout));
            let waitNote = statuses
                ? `reached ${Array.isArray(statuses) ? statuses.join(", ") : statuses}`
                : "reached idle, done or blocked";
            try {
                await runHerdr(argv, { timeoutMs: ctx.timeoutMs });
            }
            catch (err) {
                // Don't lose the output if the wait times out — read whatever is there.
                waitNote = `wait did not complete (${err instanceof Error ? err.message : String(err)})`;
            }
            const read = await runHerdr([
                "agent",
                "read",
                target,
                "--source",
                readSource,
                "--lines",
                String(lines),
                "--format",
                "text",
            ], { timeoutMs: ctx.timeoutMs });
            return ok(`# Handoff to "${target}" — ${waitNote}\n\n${formatResult(read)}`);
        },
    },
];
//# sourceMappingURL=composite.js.map