#!/usr/bin/env node
/**
 * Live smoke test for herdr-mesh against a running herdr 0.9.5 server.
 *
 * Starts dist/index.js over MCP stdio, exercises read-only tools, then creates
 * its own scratch workspace and always closes it again. Existing workspaces are
 * never touched.
 *
 * Usage:
 *   npm run build && node scripts/smoke.mjs
 *   SMOKE_AGENT=claude node scripts/smoke.mjs   # also test agent start/prompt/wait
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.join(here, "..", "dist", "index.js");

const EXPECTED_TOOLS = [
  "herdr_agent_list",
  "herdr_agent_get",
  "herdr_agent_read",
  "herdr_agent_send",
  "herdr_agent_send_keys",
  "herdr_agent_prompt",
  "herdr_agent_wait",
  "herdr_agent_start",
  "herdr_wait_output",
  "herdr_pane_run",
  "herdr_pane_send_keys",
  "herdr_workspace_create",
  "herdr_workspace_close",
];

function textOf(result) {
  const parts = (result?.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text);
  return parts.join("\n");
}

function jsonOf(result) {
  const text = textOf(result).trim();
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function pass(message) {
  console.log(`PASS ${message}`);
}

async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    throw new Error(`${name} failed: ${textOf(result)}`);
  }
  return result;
}

async function main() {
  const client = new Client(
    { name: "herdr-mesh-smoke", version: "0.2.0" },
    { capabilities: {} },
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    stderr: "inherit",
  });
  await client.connect(transport);

  let scratchWorkspace;
  try {
    const listed = await client.listTools();
    const names = new Set(listed.tools.map((t) => t.name));
    for (const name of EXPECTED_TOOLS) {
      assert.ok(names.has(name), `missing tool ${name}`);
    }
    pass(`listed ${listed.tools.length} tools`);

    await call(client, "herdr_workspace_list");
    pass("workspace_list");

    const agentsResult = await call(client, "herdr_agent_list");
    const agentsJson = jsonOf(agentsResult);
    const agents = agentsJson?.result?.agents ?? agentsJson?.agents ?? [];
    pass(`agent_list (${agents.length} agents)`);

    const first = Array.isArray(agents) ? agents[0] : undefined;
    const target = first?.name ?? first?.pane_id;
    if (target) {
      await call(client, "herdr_agent_get", { target });
      pass(`agent_get ${target}`);
    } else {
      pass("agent_get skipped (no live agents)");
    }

    const label = `smoke-${Date.now().toString(36)}`;
    const created = await call(client, "herdr_workspace_create", {
      label,
      focus: false,
    });
    const createdJson = jsonOf(created);
    scratchWorkspace =
      createdJson?.result?.workspace?.workspace_id ??
      createdJson?.result?.workspace_id;
    const paneId =
      createdJson?.result?.root_pane?.pane_id ??
      createdJson?.result?.pane?.pane_id;
    assert.ok(scratchWorkspace, "workspace_create returned no workspace id");
    assert.ok(paneId, "workspace_create returned no pane id");
    pass(`workspace_create ${scratchWorkspace}`);

    await call(client, "herdr_pane_run", {
      pane_id: paneId,
      command: "echo smoke-ok",
    });
    pass("pane_run");

    await call(client, "herdr_wait_output", {
      pane_id: paneId,
      match: "smoke-ok",
      source: "visible",
      timeout_ms: 15_000,
    });
    pass("wait_output");

    await call(client, "herdr_pane_send_keys", {
      pane_id: paneId,
      keys: ["ctrl-c"],
    });
    pass("pane_send_keys ctrl-c (normalized)");

    if (process.env.SMOKE_AGENT) {
      const kind = process.env.SMOKE_AGENT;
      let agentWorkspace;
      try {
        const agentCreated = await call(client, "herdr_workspace_create", {
          label: `smoke-agent-${Date.now().toString(36)}`,
          focus: false,
        });
        const agentJson = jsonOf(agentCreated);
        agentWorkspace =
          agentJson?.result?.workspace?.workspace_id ??
          agentJson?.result?.workspace_id;
        const agentPane =
          agentJson?.result?.root_pane?.pane_id ??
          agentJson?.result?.pane?.pane_id;
        assert.ok(agentWorkspace, "agent workspace_create returned no workspace id");
        assert.ok(agentPane, "agent workspace_create returned no pane id");

        const agentName = `smoke-${Date.now().toString(36)}`;
        await call(client, "herdr_agent_start", {
          name: agentName,
          kind,
          pane_id: agentPane,
          focus: false,
        });
        pass(`agent_start ${agentName} (${kind})`);

        await call(client, "herdr_agent_prompt", {
          target: agentName,
          text: "Reply with OK.",
          timeout_ms: 30_000,
        });
        pass("agent_prompt");

        await call(client, "herdr_agent_wait", {
          target: agentName,
          until: ["idle", "done"],
          timeout_ms: 60_000,
        });
        pass("agent_wait");
      } finally {
        if (agentWorkspace) {
          await call(client, "herdr_workspace_close", {
            workspace_id: agentWorkspace,
          });
          pass(`workspace_close ${agentWorkspace}`);
        }
      }
    }
  } finally {
    if (scratchWorkspace) {
      await call(client, "herdr_workspace_close", {
        workspace_id: scratchWorkspace,
      });
      pass(`workspace_close ${scratchWorkspace}`);
    }
    await client.close();
  }

  console.log("smoke: ok");
}

main().catch((err) => {
  console.error("smoke: FAILED");
  console.error(err);
  process.exit(1);
});
