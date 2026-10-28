import assert from "node:assert/strict";
import test from "node:test";
import { type ToolDef, normalizeKey, extractPaneId } from "../src/tools/types.js";
import { agentTools } from "../src/tools/agent.js";
import { paneTools } from "../src/tools/pane.js";
import { sessionTools } from "../src/tools/session.js";
import { tabTools, workspaceTools } from "../src/tools/workspace.js";
import { integrationTools } from "../src/tools/integration.js";

function tool(tools: ToolDef[], name: string): ToolDef {
  const found = tools.find((t) => t.name === name);
  assert.ok(found, `missing tool ${name}`);
  return found;
}

function argsFor(
  tools: ToolDef[],
  name: string,
  args: Record<string, unknown> = {},
): string[] {
  const build = tool(tools, name).buildArgs;
  assert.ok(build, `${name} should have buildArgs`);
  return build(args);
}

test("agent tool argv", async (t) => {
  await t.test("list", () => {
    assert.deepEqual(argsFor(agentTools, "herdr_agent_list"), ["agent", "list"]);
  });

  await t.test("get", () => {
    assert.deepEqual(argsFor(agentTools, "herdr_agent_get", { target: "reviewer" }), [
      "agent",
      "get",
      "reviewer",
    ]);
  });

  await t.test("read defaults to visible/200/text like 0.1.0", () => {
    assert.deepEqual(argsFor(agentTools, "herdr_agent_read", { target: "reviewer" }), [
      "agent",
      "read",
      "reviewer",
      "--source",
      "visible",
      "--lines",
      "200",
      "--format",
      "text",
    ]);
  });

  await t.test("read accepts the detection source", () => {
    assert.deepEqual(
      argsFor(agentTools, "herdr_agent_read", {
        target: "w1:p2",
        source: "detection",
        lines: 20,
      }),
      [
        "agent",
        "read",
        "w1:p2",
        "--source",
        "detection",
        "--lines",
        "20",
        "--format",
        "text",
      ],
    );
  });

  await t.test("send-keys normalizes keys", () => {
    assert.deepEqual(
      argsFor(agentTools, "herdr_agent_send_keys", {
        target: "reviewer",
        keys: ["ctrl-c", "Enter"],
      }),
      ["agent", "send-keys", "reviewer", "ctrl+c", "Enter"],
    );
  });

  await t.test("prompt without wait/until/timeout has no --wait", () => {
    assert.deepEqual(
      argsFor(agentTools, "herdr_agent_prompt", {
        target: "reviewer",
        text: "hello world",
      }),
      ["agent", "prompt", "reviewer", "hello world"],
    );
  });

  await t.test("prompt implies --wait for timeout_ms", () => {
    assert.deepEqual(
      argsFor(agentTools, "herdr_agent_prompt", {
        target: "reviewer",
        text: "go",
        timeout_ms: 30000,
      }),
      [
        "agent",
        "prompt",
        "reviewer",
        "go",
        "--wait",
        "--timeout",
        "30000",
      ],
    );
  });

  await t.test("prompt implies --wait for until", () => {
    assert.deepEqual(
      argsFor(agentTools, "herdr_agent_prompt", {
        target: "reviewer",
        text: "go",
        until: "done",
      }),
      ["agent", "prompt", "reviewer", "go", "--wait", "--until", "done"],
    );
  });

  await t.test("prompt with wait, multiple until states and timeout", () => {
    assert.deepEqual(
      argsFor(agentTools, "herdr_agent_prompt", {
        target: "reviewer",
        text: "go",
        wait: true,
        until: ["done", "blocked"],
        timeout_ms: 5000,
      }),
      [
        "agent",
        "prompt",
        "reviewer",
        "go",
        "--wait",
        "--until",
        "done",
        "--until",
        "blocked",
        "--timeout",
        "5000",
      ],
    );
  });

  await t.test("wait with no status lets herdr use its default", () => {
    assert.deepEqual(
      argsFor(agentTools, "herdr_agent_wait", { target: "reviewer" }),
      ["agent", "wait", "reviewer"],
    );
  });

  await t.test("wait uses repeated --until for an array", () => {
    assert.deepEqual(
      argsFor(agentTools, "herdr_agent_wait", {
        target: "reviewer",
        until: ["idle", "done"],
        timeout_ms: 1000,
      }),
      [
        "agent",
        "wait",
        "reviewer",
        "--until",
        "idle",
        "--until",
        "done",
        "--timeout",
        "1000",
      ],
    );
  });

  await t.test("wait keeps the legacy status input", () => {
    assert.deepEqual(
      argsFor(agentTools, "herdr_agent_wait", {
        target: "reviewer",
        status: "working",
      }),
      ["agent", "wait", "reviewer", "--until", "working"],
    );
  });

  await t.test("wait accepts an array for the legacy status input", () => {
    assert.deepEqual(
      argsFor(agentTools, "herdr_agent_wait", {
        target: "reviewer",
        status: ["idle", "done"],
      }),
      ["agent", "wait", "reviewer", "--until", "idle", "--until", "done"],
    );
  });

  await t.test("wait prefers until over legacy status", () => {
    assert.deepEqual(
      argsFor(agentTools, "herdr_agent_wait", {
        target: "reviewer",
        until: "done",
        status: "idle",
      }),
      ["agent", "wait", "reviewer", "--until", "done"],
    );
  });

  await t.test("rename", () => {
    assert.deepEqual(
      argsFor(agentTools, "herdr_agent_rename", {
        target: "reviewer",
        name: "critic",
      }),
      ["agent", "rename", "reviewer", "critic"],
    );
    assert.deepEqual(
      argsFor(agentTools, "herdr_agent_rename", {
        target: "reviewer",
        clear: true,
      }),
      ["agent", "rename", "reviewer", "--clear"],
    );
  });

  await t.test("focus", () => {
    assert.deepEqual(argsFor(agentTools, "herdr_agent_focus", { target: "reviewer" }), [
      "agent",
      "focus",
      "reviewer",
    ]);
  });
});

test("pane tool argv", async (t) => {
  await t.test("list", () => {
    assert.deepEqual(argsFor(paneTools, "herdr_pane_list"), ["pane", "list"]);
    assert.deepEqual(argsFor(paneTools, "herdr_pane_list", { workspace: "w1" }), [
      "pane",
      "list",
      "--workspace",
      "w1",
    ]);
  });

  await t.test("get", () => {
    assert.deepEqual(argsFor(paneTools, "herdr_pane_get", { pane_id: "w1:p1" }), [
      "pane",
      "get",
      "w1:p1",
    ]);
  });

  await t.test("read", () => {
    assert.deepEqual(argsFor(paneTools, "herdr_pane_read", { pane_id: "w1:p1" }), [
      "pane",
      "read",
      "w1:p1",
      "--lines",
      "200",
      "--format",
      "text",
    ]);
    assert.deepEqual(
      argsFor(paneTools, "herdr_pane_read", {
        pane_id: "w1:p1",
        source: "detection",
        lines: 10,
      }),
      [
        "pane",
        "read",
        "w1:p1",
        "--source",
        "detection",
        "--lines",
        "10",
        "--format",
        "text",
      ],
    );
  });

  await t.test("wait-output match", () => {
    assert.deepEqual(
      argsFor(paneTools, "herdr_wait_output", {
        pane_id: "w1:p1",
        match: "BUILD SUCCESS",
      }),
      ["pane", "wait-output", "w1:p1", "--match", "BUILD SUCCESS"],
    );
  });

  await t.test("wait-output regex with source, lines, timeout and raw", () => {
    assert.deepEqual(
      argsFor(paneTools, "herdr_wait_output", {
        pane_id: "w1:p1",
        match: "READY\\s+\\d+",
        regex: true,
        source: "recent-unwrapped",
        lines: 50,
        timeout_ms: 1000,
        raw: true,
      }),
      [
        "pane",
        "wait-output",
        "w1:p1",
        "--regex",
        "READY\\s+\\d+",
        "--source",
        "recent-unwrapped",
        "--lines",
        "50",
        "--timeout",
        "1000",
        "--raw",
      ],
    );
  });

  await t.test("split", () => {
    assert.deepEqual(
      argsFor(paneTools, "herdr_pane_split", {
        pane_id: "w1:p1",
        direction: "down",
        cwd: "/tmp",
        focus: false,
      }),
      [
        "pane",
        "split",
        "w1:p1",
        "--direction",
        "down",
        "--cwd",
        "/tmp",
        "--no-focus",
      ],
    );
  });

  await t.test("run", () => {
    assert.deepEqual(
      argsFor(paneTools, "herdr_pane_run", {
        pane_id: "w1:p1",
        command: "echo hi",
      }),
      ["pane", "run", "w1:p1", "echo hi"],
    );
  });

  await t.test("send-text", () => {
    assert.deepEqual(
      argsFor(paneTools, "herdr_pane_send_text", {
        pane_id: "w1:p1",
        text: "draft",
      }),
      ["pane", "send-text", "w1:p1", "draft"],
    );
  });

  await t.test("send-keys normalizes modifiers", () => {
    assert.deepEqual(
      argsFor(paneTools, "herdr_pane_send_keys", {
        pane_id: "w1:p1",
        keys: ["ctrl-c", "Escape", "tab"],
      }),
      ["pane", "send-keys", "w1:p1", "ctrl+c", "esc", "tab"],
    );
  });

  await t.test("close", () => {
    assert.deepEqual(argsFor(paneTools, "herdr_pane_close", { pane_id: "w1:p1" }), [
      "pane",
      "close",
      "w1:p1",
    ]);
  });

  await t.test("rename", () => {
    assert.deepEqual(
      argsFor(paneTools, "herdr_pane_rename", {
        pane_id: "w1:p1",
        label: "build",
      }),
      ["pane", "rename", "w1:p1", "build"],
    );
    assert.deepEqual(
      argsFor(paneTools, "herdr_pane_rename", {
        pane_id: "w1:p1",
        clear: true,
      }),
      ["pane", "rename", "w1:p1", "--clear"],
    );
  });
});

test("session tool argv", () => {
  assert.deepEqual(argsFor(sessionTools, "herdr_session_list"), [
    "session",
    "list",
    "--json",
  ]);
  assert.deepEqual(argsFor(sessionTools, "herdr_session_stop", { name: "default" }), [
    "session",
    "stop",
    "default",
    "--json",
  ]);
  assert.deepEqual(
    argsFor(sessionTools, "herdr_session_delete", { name: "scratch" }),
    ["session", "delete", "scratch", "--json"],
  );
});

test("tab tool argv", async (t) => {
  await t.test("list", () => {
    assert.deepEqual(argsFor(tabTools, "herdr_tab_list"), ["tab", "list"]);
  });

  await t.test("create", () => {
    assert.deepEqual(argsFor(tabTools, "herdr_tab_create"), ["tab", "create"]);
    assert.deepEqual(
      argsFor(tabTools, "herdr_tab_create", {
        workspace: "w1",
        cwd: "/tmp",
        label: "work",
        focus: false,
      }),
      [
        "tab",
        "create",
        "--workspace",
        "w1",
        "--cwd",
        "/tmp",
        "--label",
        "work",
        "--no-focus",
      ],
    );
  });

  await t.test("get/focus/rename/close", () => {
    assert.deepEqual(argsFor(tabTools, "herdr_tab_get", { tab_id: "w1:t1" }), [
      "tab",
      "get",
      "w1:t1",
    ]);
    assert.deepEqual(argsFor(tabTools, "herdr_tab_focus", { tab_id: "w1:t1" }), [
      "tab",
      "focus",
      "w1:t1",
    ]);
    assert.deepEqual(
      argsFor(tabTools, "herdr_tab_rename", { tab_id: "w1:t1", label: "new" }),
      ["tab", "rename", "w1:t1", "new"],
    );
    assert.deepEqual(argsFor(tabTools, "herdr_tab_close", { tab_id: "w1:t1" }), [
      "tab",
      "close",
      "w1:t1",
    ]);
  });
});

test("workspace tool argv", async (t) => {
  await t.test("list", () => {
    assert.deepEqual(argsFor(workspaceTools, "herdr_workspace_list"), [
      "workspace",
      "list",
    ]);
  });

  await t.test("create", () => {
    assert.deepEqual(argsFor(workspaceTools, "herdr_workspace_create"), [
      "workspace",
      "create",
    ]);
    assert.deepEqual(
      argsFor(workspaceTools, "herdr_workspace_create", {
        cwd: "/tmp",
        label: "agent",
        focus: true,
      }),
      ["workspace", "create", "--cwd", "/tmp", "--label", "agent", "--focus"],
    );
  });

  await t.test("get/focus/rename/close", () => {
    assert.deepEqual(
      argsFor(workspaceTools, "herdr_workspace_get", { workspace_id: "w1" }),
      ["workspace", "get", "w1"],
    );
    assert.deepEqual(
      argsFor(workspaceTools, "herdr_workspace_focus", { workspace_id: "w1" }),
      ["workspace", "focus", "w1"],
    );
    assert.deepEqual(
      argsFor(workspaceTools, "herdr_workspace_rename", {
        workspace_id: "w1",
        label: "new",
      }),
      ["workspace", "rename", "w1", "new"],
    );
    assert.deepEqual(
      argsFor(workspaceTools, "herdr_workspace_close", { workspace_id: "w1" }),
      ["workspace", "close", "w1"],
    );
  });
});

test("integration tool argv", () => {
  assert.deepEqual(argsFor(integrationTools, "herdr_integration_status"), [
    "integration",
    "status",
  ]);
  assert.deepEqual(
    argsFor(integrationTools, "herdr_integration_status", { outdated_only: true }),
    ["integration", "status", "--outdated-only"],
  );
});

test("normalizeKey", async (t) => {
  const cases: Array<[string, string]> = [
    ["ctrl-c", "ctrl+c"],
    ["Ctrl-C", "ctrl+C"],
    ["Ctrl-Shift-C", "ctrl+shift+C"],
    ["ctrl-alt-delete", "ctrl+alt+delete"],
    ["meta-shift-x", "meta+shift+x"],
    ["super-a", "super+a"],
    ["shift-tab", "shift+tab"],
    ["  escape ", "esc"],
    ["ESCAPE", "esc"],
    ["C-c", "C-c"],
    ["enter", "enter"],
    ["tab", "tab"],
    ["up", "up"],
    ["F1", "F1"],
    ["ctrl--c", "ctrl--c"],
  ];
  for (const [input, expected] of cases) {
    await t.test(`${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, () => {
      assert.equal(normalizeKey(input), expected);
    });
  }
});

test("extractPaneId reads documented result shapes only", () => {
  assert.equal(
    extractPaneId({ result: { agent: { pane_id: "w1:p1" }, type: "agent_info" } }),
    "w1:p1",
  );
  assert.equal(
    extractPaneId({ result: { pane: { pane_id: "w1:p2" }, type: "pane_info" } }),
    "w1:p2",
  );
  assert.equal(
    extractPaneId({
      result: { root_pane: { pane_id: "w1:p3" }, type: "workspace_created" },
    }),
    "w1:p3",
  );
  assert.equal(extractPaneId({ result: { type: "ok" } }), undefined);
  assert.equal(extractPaneId(undefined), undefined);
});
