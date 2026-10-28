import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type ToolDef, execTool } from "./tools/types.js";
import { agentTools } from "./tools/agent.js";
import { sessionTools } from "./tools/session.js";
import { paneTools } from "./tools/pane.js";
import { tabTools, workspaceTools } from "./tools/workspace.js";
import { integrationTools } from "./tools/integration.js";
import { compositeTools } from "./tools/composite.js";

const allTools: ToolDef[] = [
  ...compositeTools,
  ...agentTools,
  ...sessionTools,
  ...paneTools,
  ...tabTools,
  ...workspaceTools,
  ...integrationTools,
];

export function createServer(): McpServer {
  const server = new McpServer({
    name: "herdr-mesh",
    version: "0.2.0",
  });

  for (const tool of allTools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async (args: Record<string, unknown>) => execTool(tool, args ?? {}),
    );
  }

  return server;
}
