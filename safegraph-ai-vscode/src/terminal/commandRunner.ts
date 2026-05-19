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
    if (/<<\s*['"]?\w+['"]?/.test(block)) continue;
    for (const line of block.split(/\r?\n/)) {
      const cmd = line.trim();
      if (!cmd) continue;
      if (cmd.startsWith("#")) continue;
      if (cmd.startsWith("::")) continue;
      if (cmd.startsWith("+") || cmd.startsWith("-") || cmd.startsWith("@@")) continue;
      if (/^(cat\s+>\s+|tee\s+|touch\s+|echo\s+.+>\s+|printf\s+.+>\s+)/i.test(cmd)) continue;
      commands.push(cmd);
    }
  }
  return commands;
}

export class CommandRunner {
  private procs = new Map<string, ChildProcessWithoutNullStreams>();
  private timeouts = new Map<string, NodeJS.Timeout>();

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
    if (this.procs.has(id)) {
      this.output.appendLine(`[cmd] ${id}: already running`);
      return;
    }

    post({ type: "commandUpdate", id, status: "running", ts: Date.now() });
    this.output.appendLine(`[cmd] ${id}: running in ${cwd}`);
    this.output.appendLine(`[cmd] ${id}: ${cmd}`);

    const p = spawn(cmd, {
      cwd,
      shell: true,
      windowsHide: true,
      env: process.env,
      timeout: 300000 // 5 min timeout
    });
    this.procs.set(id, p);

    let output = "";
    let errorOutput = "";

    p.stdout.on("data", (d) => {
      const chunk = d.toString();
      output += chunk;
      this.output.appendLine(`[out] ${chunk.trim()}`);
      post({ type: "commandUpdate", id, status: "running", output: chunk, ts: Date.now() });
    });

    p.stderr.on("data", (d) => {
      const chunk = d.toString();
      errorOutput += chunk;
      this.output.appendLine(`[err] ${chunk.trim()}`);
      post({ type: "commandUpdate", id, status: "running", output: chunk, ts: Date.now() });
    });

    p.on("error", (e) => {
      this.cleanup(id);
      const msg = `Command error: ${String(e)}`;
      this.output.appendLine(`[cmd] ${id}: ${msg}`);
      post({ type: "commandUpdate", id, status: "error", output: msg, ts: Date.now() });
    });

    p.on("exit", (code) => {
      this.cleanup(id);
      const status = code === 0 || code === null ? "success" : "error";
      this.output.appendLine(`[cmd] ${id}: exit code ${code} (${status})`);
      post({
        type: "commandUpdate",
        id,
        status,
        output: `Command exited with code ${code}`,
        exitCode: code ?? undefined,
        ts: Date.now()
      });
    });

    // Set a timeout to kill the process after 5 minutes
    const timeout = setTimeout(() => {
      if (this.procs.has(id)) {
        this.output.appendLine(`[cmd] ${id}: timeout (5 min), killing process`);
        try {
          p.kill("SIGTERM");
        } catch {
          // ignore
        }
      }
    }, 300000);
    this.timeouts.set(id, timeout);
  }

  cancel(id: string, post: (m: CommandUpdateMessage) => void) {
    const p = this.procs.get(id);
    if (!p) {
      this.output.appendLine(`[cmd] ${id}: not found or already finished`);
      return;
    }
    try {
      p.kill("SIGTERM");
      this.output.appendLine(`[cmd] ${id}: kill signal sent`);
    } catch (e) {
      this.output.appendLine(`[cmd] ${id}: error killing: ${String(e)}`);
    }
    this.cleanup(id);
    post({ type: "commandUpdate", id, status: "canceled", ts: Date.now() });
  }

  private cleanup(id: string) {
    this.procs.delete(id);
    const timeout = this.timeouts.get(id);
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(id);
    }
  }
}
