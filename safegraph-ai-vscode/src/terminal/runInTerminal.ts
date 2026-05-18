import * as vscode from "vscode";
import { decideCommand, AutoRunMode } from "./commandPolicy";

let terminal: vscode.Terminal | undefined;

function getTerminal() {
  if (terminal) return terminal;
  terminal = vscode.window.createTerminal({ name: "Safegraph AI" });
  return terminal;
}

export async function autoRunCommandsFromText(text: string, output: vscode.OutputChannel) {
  const cfg = vscode.workspace.getConfiguration("safegraph");
  const mode = String(cfg.get("autoRun") || "safe") as AutoRunMode;
  if (mode === "off") return;

  // Extract shell-ish fenced blocks and simple "Command:" lines.
  const commands: string[] = [];
  const fenceRe = /```(?:sh|bash|powershell|ps1|cmd)\s*([\s\S]*?)```/gi;
  for (const m of text.matchAll(fenceRe)) {
    const block = (m[1] || "").trim();
    for (const line of block.split(/\r?\n/)) {
      const cmd = line.trim();
      if (!cmd) continue;
      if (cmd.startsWith("#")) continue;
      if (cmd.startsWith("::")) continue;
      // Ignore diff-like prefixes that models sometimes include by mistake.
      if (cmd.startsWith("+") || cmd.startsWith("-") || cmd.startsWith("@@")) continue;
      commands.push(cmd);
    }
  }

  const lineRe = /^\s*(?:Command|Run|Chay)\s*:\s*(.+)$/gim;
  for (const m of text.matchAll(lineRe)) {
    const cmd = String(m[1] || "").trim();
    if (cmd) commands.push(cmd);
  }

  if (commands.length === 0) return;

  const term = getTerminal();
  term.show(true);

  for (const cmd of commands) {
    const decision = decideCommand(cmd, mode);
    if (decision.decision === "deny") {
      output.appendLine(`[auto-run] deny: ${cmd} (${decision.reason})`);
      continue;
    }
    if (decision.decision === "ask") {
      const ok = await vscode.window.showWarningMessage(
        `Run command?\n${cmd}\nReason: ${decision.reason}`,
        { modal: true },
        "Run"
      );
      if (ok !== "Run") {
        output.appendLine(`[auto-run] skipped by user: ${cmd}`);
        continue;
      }
    }
    output.appendLine(`[auto-run] running: ${cmd}`);
    term.sendText(cmd, true);
  }
}
