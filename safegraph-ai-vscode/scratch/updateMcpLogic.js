const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '../src/chat/ChatViewProvider.ts');
let content = fs.readFileSync(target, 'utf8');

// Ensure path and fs are imported if not already
if (!content.includes('import * as fs from "fs"')) {
  content = content.replace('import * as vscode from "vscode";', 'import * as vscode from "vscode";\nimport * as fs from "fs";\nimport * as path from "path";');
}

// Prepare MCP config fetching
const fetchMcpConfigCode = `
          let toolConfig: any = undefined;
          try {
            const mcpJsonPath = path.join(cwd, ".vscode", "mcp.json");
            if (fs.existsSync(mcpJsonPath)) {
              const mcpConf = JSON.parse(fs.readFileSync(mcpJsonPath, "utf8"));
              if (mcpConf.mcpServers) {
                const toolsList: any[] = [];
                for (const [serverId, serverConfig] of Object.entries<any>(mcpConf.mcpServers)) {
                  try {
                    await this.mcpManager.connectStdio(serverId, serverConfig.command, serverConfig.args, serverConfig.env);
                    const tools = await this.mcpManager.listTools(serverId);
                    for (const t of tools.tools) {
                      toolsList.push({
                        toolSpec: {
                          name: \`\${serverId}__\${t.name}\`.replace(/[^a-zA-Z0-9_-]/g, "_"),
                          description: t.description || "No description",
                          inputSchema: {
                            json: t.inputSchema
                          }
                        }
                      });
                    }
                  } catch (e) {
                    this.output.appendLine(\`[MCP] Error connecting to \${serverId}: \${e}\`);
                  }
                }
                if (toolsList.length > 0) {
                  toolConfig = { tools: toolsList };
                }
              }
            }
          } catch(e) {
            this.output.appendLine(\`[MCP] Error loading mcp.json: \${e}\`);
          }

          for (let step = 0; step < maxTaskLoops; step++) {`;

if (!content.includes('const mcpJsonPath = path.join(cwd, ".vscode", "mcp.json");')) {
  content = content.replace('for (let step = 0; step < maxTaskLoops; step++) {', fetchMcpConfigCode);
}

// Modify the bedrockConverse call to include toolConfig
content = content.replace(
  /const r = await bedrockConverse\(nextMessages, \{([\s\S]*?)temperature: 0\.2\s*\}\);/,
  `const r = await bedrockConverse(nextMessages, {
                region,
                modelId,
                apiKey,
                signal: this.currentAbort?.signal,
                maxTokens: 8192,
                temperature: 0.2,
                toolConfig
              });`
);

// We need to capture rawContent and stopReason. We can do this by modifying the inner loop slightly.
const innerLoopReplace = `
              const r = await bedrockConverse(nextMessages, {
                region,
                modelId,
                apiKey,
                signal: this.currentAbort?.signal,
                maxTokens: 8192,
                temperature: 0.2,
                toolConfig
              });
              let rawContent = r.raw?.output?.message?.content || [];
              let stopReason = String(r.stopReason || "");
              combined = (combined + (combined ? "\\n" : "") + r.text).trim();
              chunkLoops += 1;
              if (this.currentAbort?.signal.aborted) throw new Error("aborted");
              
              if (stopReason === "tool_use") {
                const toolUses = rawContent.filter((c: any) => c.toolUse);
                if (toolUses.length > 0) {
                  messages.push({ role: "assistant", content: rawContent });
                  webviewView.webview.postMessage({
                    type: "assistantMessage",
                    id: msg.id + "_tool_" + step,
                    text: \`Calling \${toolUses.length} tools...\`,
                    ts: Date.now(),
                    done: false
                  });

                  let toolResults = [];
                  for (const tu of toolUses) {
                    const call = tu.toolUse;
                    try {
                      // parse serverId__toolName
                      const nameParts = call.name.split("__");
                      const serverId = nameParts[0];
                      const toolName = nameParts.slice(1).join("__");
                      this.output.appendLine(\`[MCP] Calling \${serverId} -> \${toolName}\`);
                      
                      const result = await this.mcpManager.callTool(serverId, toolName, call.input);
                      
                      // extract text content from result
                      let resultText = "";
                      if (result && Array.isArray(result.content)) {
                        resultText = result.content.map((c:any) => c.text).join("\\n");
                      } else {
                        resultText = JSON.stringify(result);
                      }

                      toolResults.push({
                        toolResult: {
                          toolUseId: call.toolUseId,
                          content: [{ text: resultText.slice(0, 8000) }],
                          status: "success"
                        }
                      });
                    } catch(e) {
                      toolResults.push({
                        toolResult: {
                          toolUseId: call.toolUseId,
                          content: [{ text: String(e) }],
                          status: "error"
                        }
                      });
                    }
                  }
                  messages.push({ role: "user", content: toolResults });
                  isToolLoop = true;
                  break; // break the chunk loop, and we will continue the main loop
                }
              }

              if (stopReason !== "max_tokens" || chunkLoops >= 3) break;
`;

if (!content.includes('isToolLoop = true;')) {
  // We need to inject `let isToolLoop = false;` before `for (;;)`
  content = content.replace(
    /for \(\;;\) \{/,
    'let isToolLoop = false;\n            for (;;) {'
  );

  content = content.replace(
    /const r = await bedrockConverse\(nextMessages, \{([\s\S]*?)if \(r\.stopReason \!\=\= "max_tokens" \|\| chunkLoops \>\= 3\) break;/,
    innerLoopReplace
  );
  
  // After the inner loop, if `isToolLoop` is true, we should `continue` the main loop!
  content = content.replace(
    /messages\.push\(\{ role: "assistant", text: combined \}\);/,
    `if (isToolLoop) continue;\n            messages.push({ role: "assistant", text: combined });`
  );
}

fs.writeFileSync(target, content, 'utf8');
console.log("MCP Loop injected.");
