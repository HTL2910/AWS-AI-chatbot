const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '../src/chat/ChatViewProvider.ts');
let content = fs.readFileSync(target, 'utf8');

// 1. Import McpClientManager
if (!content.includes('McpClientManager')) {
  content = content.replace(
    'import { CommandRunner',
    'import { McpClientManager } from "../mcp/McpClient";\nimport { CommandRunner'
  );
}

// 2. Add mcpManager to ChatViewProvider
if (!content.includes('private mcpManager: McpClientManager')) {
  content = content.replace(
    'private cmdRunner: CommandRunner;',
    'private cmdRunner: CommandRunner;\n  private mcpManager: McpClientManager;'
  );
  content = content.replace(
    'this.cmdRunner = new CommandRunner(output);',
    'this.cmdRunner = new CommandRunner(output);\n    this.mcpManager = new McpClientManager(output);'
  );
}

// 3. Update messages array type
content = content.replace(
  'const messages: { role: "user" | "assistant"; text: string }[] = [',
  'const messages: { role: "user" | "assistant"; text?: string; content?: any[] }[] = ['
);

// 4. Update the history push
content = content.replace(
  /this\.history\.push\(\{ role: "user", text: msg\.text \}\);\s*this\.history\.push\(\{ role: "assistant", text: totalAcc \}\);/g,
  'this.history.push({ role: "user", text: msg.text });\n          this.history.push({ role: "assistant", text: totalAcc });'
);

fs.writeFileSync(target, content, 'utf8');
console.log("ChatViewProvider.ts patched.");
