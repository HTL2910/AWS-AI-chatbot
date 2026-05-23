import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
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

export type CommandRunResult = {
  id: string;
  cmd: string;
  status: "success" | "error" | "canceled";
  output: string;
  exitCode?: number;
};

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

    const runCmd = this.normalizeWorkspaceCommand(cmd, cwd);
    post({ type: "commandUpdate", id, status: "running", ts: Date.now() });
    this.output.appendLine(`[cmd] ${id}: running in ${cwd}`);
    this.output.appendLine(`[cmd] ${id}: ${runCmd}${runCmd !== cmd ? ` (rewritten from: ${cmd})` : ""}`);

    const p = spawn(runCmd, {
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

  runAndWait(id: string, cmd: string, cwd: string, post: (m: CommandUpdateMessage) => void): Promise<CommandRunResult> {
    return new Promise((resolve) => {
      if (this.procs.has(id)) {
        const output = "Command is already running.";
        this.output.appendLine(`[cmd] ${id}: ${output}`);
        resolve({ id, cmd, status: "error", output });
        return;
      }

      const runCmd = this.normalizeWorkspaceCommand(cmd, cwd);
      post({ type: "commandUpdate", id, status: "running", ts: Date.now() });
      this.output.appendLine(`[cmd] ${id}: running in ${cwd}`);
      this.output.appendLine(`[cmd] ${id}: ${runCmd}${runCmd !== cmd ? ` (rewritten from: ${cmd})` : ""}`);

      const p = spawn(runCmd, {
        cwd,
        shell: true,
        windowsHide: true,
        env: process.env,
        timeout: 300000
      });
      this.procs.set(id, p);

      let output = "";
      let settled = false;
      const finish = (status: "success" | "error" | "canceled", exitCode?: number, finalOutput?: string) => {
        if (settled) return;
        settled = true;
        this.cleanup(id);
        const extra = finalOutput ? `${output}${output ? "\n" : ""}${finalOutput}` : output;
        post({ type: "commandUpdate", id, status, output: finalOutput, exitCode, ts: Date.now() });
        resolve({ id, cmd: runCmd, status, output: extra, exitCode });
      };

      p.stdout.on("data", (d) => {
        const chunk = d.toString();
        output += chunk;
        this.output.appendLine(`[out] ${chunk.trim()}`);
        post({ type: "commandUpdate", id, status: "running", output: chunk, ts: Date.now() });
      });

      p.stderr.on("data", (d) => {
        const chunk = d.toString();
        output += chunk;
        this.output.appendLine(`[err] ${chunk.trim()}`);
        post({ type: "commandUpdate", id, status: "running", output: chunk, ts: Date.now() });
      });

      p.on("error", (e) => {
        const msg = `Command error: ${String(e)}`;
        this.output.appendLine(`[cmd] ${id}: ${msg}`);
        finish("error", undefined, msg);
      });

      p.on("exit", (code) => {
        const status = code === 0 || code === null ? "success" : "error";
        const msg = `Command exited with code ${code}`;
        this.output.appendLine(`[cmd] ${id}: exit code ${code} (${status})`);
        finish(status, code ?? undefined, msg);
      });

      const timeout = setTimeout(() => {
        if (this.procs.has(id)) {
          this.output.appendLine(`[cmd] ${id}: timeout (5 min), killing process`);
          try {
            p.kill("SIGTERM");
          } catch {
            // ignore
          }
          finish("error", undefined, "Command timed out after 5 minutes.");
        }
      }, 300000);
      this.timeouts.set(id, timeout);
    });
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

  private normalizeWorkspaceCommand(cmd: string, cwd: string) {
    const trimmed = cmd.trim();
    if (!/^python(?:3(?:\.\d+)?)?\s+/i.test(trimmed)) return cmd;
    if (/[;&|`$(){}[\]<>]/.test(trimmed)) return cmd;

    const parts = trimmed.split(/\s+/);
    const python = this.findPython(cwd);
    if (python) parts[0] = this.shellQuote(python);

    const scriptIndex = parts.findIndex((part, index) => index > 0 && /\.py$/i.test(part));
    if (scriptIndex > 0) {
      const rawScript = parts[scriptIndex].replace(/^['"]|['"]$/g, "");
      const scriptPath = path.isAbsolute(rawScript) ? rawScript : path.join(cwd, rawScript);
      if (!fs.existsSync(scriptPath)) {
        const found = this.findPythonScript(cwd, path.basename(rawScript));
        if (found) parts[scriptIndex] = this.shellQuote(path.relative(cwd, found).replace(/\\/g, "/"));
      }
    }

    return parts.join(" ");
  }

  private findPython(cwd: string) {
    const candidates = [
      path.join(cwd, "venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python"),
      path.join(cwd, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python"),
      path.join(cwd, ".safegraph-venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python"),
      "/usr/bin/python3",
      "/opt/homebrew/bin/python3",
      "/usr/local/bin/python3"
    ];
    return candidates.find((candidate) => {
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
  }

  private findPythonScript(root: string, basename: string) {
    const ignored = new Set(["node_modules", ".git", "venv", ".venv", ".safegraph-venv", "__pycache__", "out", "dist", "build"]);
    const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
    while (queue.length) {
      const current = queue.shift()!;
      if (current.depth > 5) continue;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(current.dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = path.join(current.dir, entry.name);
        if (entry.isFile() && entry.name === basename) return full;
        if (entry.isDirectory() && !ignored.has(entry.name)) queue.push({ dir: full, depth: current.depth + 1 });
      }
    }
    return "";
  }

  private shellQuote(value: string) {
    if (/^[\w./:-]+$/.test(value)) return value;
    return `'${value.replace(/'/g, "'\\''")}'`;
  }
}
