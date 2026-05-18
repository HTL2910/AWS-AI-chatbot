import * as vscode from "vscode";
import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import { decideCommand, AutoRunMode } from "./commandPolicy";

export type ProposedCommand = {
  id: string;
  cmd: string;
  decision: "deny" | "ask" | "allow";
  reason: string;
};

export type CommandStatus = "queued" | "running" | "success" | "error" | "denied" | "canceled";

export type CommandUpdateMessage =
  | { type: "commandProposed"; items: ProposedCommand[]; ts: number }
  | { type: "commandUpdate"; id: string; status: CommandStatus; output?: string; exitCode?: number; ts: number };

export function extractCommandsFromText(text: string) {
  const commands: string[] = [];
  const fenceRe = /```(?:sh|bash|powershell|ps1|cmd)\s*([\s\S]*?)```/gi;
  for (const m of String(text || "").matchAll(fenceRe)) {
    const block = (m[1] || "").trim();
    for (const line of block.split(/\r?\n/)) {
      const cmd = line.trim();
      if (!cmd) continue;
      if (cmd.startsWith("#")) continue;
      if (cmd.startsWith("::")) continue;
      if (cmd.startsWith("+") || cmd.startsWith("-") || cmd.startsWith("@@")) continue;
      commands.push(cmd);
    }
  }
  return commands;
}

export class CommandRunner {
  private procs = new Map<string, ChildProcessWithoutNullStreams>();

  constructor(private readonly output: vscode.OutputChannel) {}

  proposeFromAssistantText(text: string, mode: AutoRunMode): ProposedCommand[] {
    const cmds = extractCommandsFromText(text);
    const items: ProposedCommand[] = [];
    for (const cmd of cmds) {
      const d = decideCommand(cmd, mode);
      items.push({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        cmd,
        decision: d.decision,
        reason: d.reason
      });
    }
    return items;
  }

  run(id: string, cmd: string, cwd: string, post: (m: CommandUpdateMessage) => void) {
    if (this.procs.has(id)) return;

    post({ type: "commandUpdate", id, status: "running", ts: Date.now() });
    this.output.appendLine(`[cmd] running: ${cmd}`);

    const p = spawn(cmd, {
      cwd,
      shell: true,
      windowsHide: true,
      env: process.env
    });
    this.procs.set(id, p);

    p.stdout.on("data", (d) => {
      post({ type: "commandUpdate", id, status: "running", output: d.toString(), ts: Date.now() });
    });
    p.stderr.on("data", (d) => {
      post({ type: "commandUpdate", id, status: "running", output: d.toString(), ts: Date.now() });
    });
    p.on("error", (e) => {
      this.procs.delete(id);
      post({ type: "commandUpdate", id, status: "error", output: String(e), ts: Date.now() });
    });
    p.on("exit", (code) => {
      this.procs.delete(id);
      post({
        type: "commandUpdate",
        id,
        status: code === 0 ? "success" : "error",
        exitCode: code ?? undefined,
        ts: Date.now()
      });
    });
  }

  cancel(id: string, post: (m: CommandUpdateMessage) => void) {
    const p = this.procs.get(id);
    if (!p) return;
    try {
      p.kill();
    } catch {
      // ignore
    }
    this.procs.delete(id);
    post({ type: "commandUpdate", id, status: "canceled", ts: Date.now() });
  }
}

