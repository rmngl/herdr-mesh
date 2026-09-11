import { z } from "zod";
import { runHerdr } from "../herdr.js";
import { agentStatusSchema, toStatusList, ok, formatResult, targetSchema, } from "./types.js";
import { resolvePaneId } from "./resolve.js";
export const compositeTools = [
    {
        name: "herdr_relay",
        description: "Deliver a message to an agent AND submit it. Use this for normal agent-to-agent messaging — it avoids the common mistake of sending text that never gets submitted. Set submit=false to type without Enter. herdr refuses to prompt an agent that is currently `blocked` on an approval prompt.",
        inputSchema: {
            target: targetSchema,
            text: z.string().describe("Message/prompt to deliver to the agent."),
            submit: z.boolean().optional().describe("Submit after typing (default true)."),
        },
        run: async (a) => {
            const target = String(a.target);
            const submit = a.submit !== false;
            if (!submit) {
                const paneId = await resolvePaneId(target);
                const res = await runHerdr(["pane", "send-text", paneId, String(a.text)]);
                return ok(`${formatResult(res)}\n\nTyped into "${target}" (not submitted).`);
            }
            // `agent prompt` types and submits in one step and honours bracketed paste,
            // so a multi-line message is not interpreted as a series of submissions.
            const res = await runHerdr(["agent", "prompt", target, String(a.text)]);
            return ok(`${formatResult(res)}\n\nDelivered to "${target}" and submitted.`);
        },
    },
    {
        name: "herdr_handoff",
        description: "Hand a task to another agent and wait for its result in one step: deliver the message, wait until the agent is ready again, then read its output back. Use this for review/fix/verify handoffs so the multi-step chain can't break midway. Returns the target agent's resulting output.",
        inputSchema: {
            target: targetSchema,
            message: z.string().describe("Task/prompt to hand to the agent."),
            wait_status: z
                .union([agentStatusSchema, z.array(agentStatusSchema).min(1)])
                .optional()
                .describe("Status(es) to wait for before reading back (default: idle)."),
            timeout_ms: z
                .number()
                .int()
                .positive()
                .optional()
                .describe("Max time to wait for the status (default 120000)."),
            read_lines: z
                .number()
                .int()
                .positive()
                .max(2000)
                .optional()
                .describe("Lines of output to read back (default 200)."),
        },
        timeoutMs: 180_000,
        run: async (a) => {
            const target = String(a.target);
            const statuses = toStatusList(a.wait_status);
            const until = statuses.length > 0 ? statuses : ["idle"];
            const timeout = a.timeout_ms ?? 120_000;
            const lines = a.read_lines ?? 200;
            // One call delivers, submits and waits. If it reports a stall, do NOT retry
            // the prompt: a stall does not prove the text was never sent, and resending
            // would hand the same task over twice.
            const argv = ["agent", "prompt", target, String(a.message), "--wait"];
            for (const s of until)
                argv.push("--until", s);
            argv.push("--timeout", String(timeout));
            let waitNote = `reached ${until.join(" or ")}`;
            try {
                await runHerdr(argv, { timeoutMs: timeout + 10_000 });
            }
            catch (err) {
                // Don't lose the output if the wait times out — read whatever is there and
                // let the caller decide, rather than silently re-prompting.
                waitNote = `wait did not complete (${err instanceof Error ? err.message : String(err)}) — the message may still have been delivered, so read the output before retrying`;
            }
            const read = await runHerdr([
                "agent",
                "read",
                target,
                "--source",
                "visible",
                "--lines",
                String(lines),
                "--format",
                "text",
            ]);
            return ok(`# Handoff to "${target}" — ${waitNote}\n\n${formatResult(read)}`);
        },
    },
];
//# sourceMappingURL=composite.js.map