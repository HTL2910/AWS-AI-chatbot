import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as vscode from "vscode";

export class McpClientManager {
  private clients = new Map<string, Client>();
  private output: vscode.OutputChannel;

  constructor(output: vscode.OutputChannel) {
    this.output = output;
  }

  async connectStdio(serverId: string, command: string, args: string[], env?: Record<string, string>) {
    if (this.clients.has(serverId)) {
      return this.clients.get(serverId)!;
    }

    this.output.appendLine(`[MCP] Starting Stdio client for server: ${serverId}`);
    const transport = new StdioClientTransport({
      command,
      args,
      env
    });

    const client = new Client(
      {
        name: "safegraph-ai",
        version: "0.7.0"
      },
      {
        capabilities: {}
      }
    );

    await client.connect(transport);
    this.clients.set(serverId, client);
    this.output.appendLine(`[MCP] Connected to ${serverId} successfully.`);
    return client;
  }

  async listTools(serverId: string) {
    const client = this.clients.get(serverId);
    if (!client) throw new Error(`MCP Client ${serverId} not connected`);
    return await client.listTools();
  }

  async callTool(serverId: string, toolName: string, args: any) {
    const client = this.clients.get(serverId);
    if (!client) throw new Error(`MCP Client ${serverId} not connected`);
    return await client.callTool({
      name: toolName,
      arguments: args
    });
  }

  disconnectAll() {
    for (const [id, client] of this.clients.entries()) {
      try {
        client.close();
        this.output.appendLine(`[MCP] Disconnected from ${id}`);
      } catch (e) {
        this.output.appendLine(`[MCP] Failed to close ${id}: ${String(e)}`);
      }
    }
    this.clients.clear();
  }
}
