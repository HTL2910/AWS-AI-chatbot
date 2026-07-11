export type AutoRunMode = "off" | "safe" | "ask";

export type CommandDecision =
  | { decision: "deny"; reason: string }
  | { decision: "ask"; reason: string }
  | { decision: "allow"; reason: string };

const SAFE_COMMANDS = [
  /^npm\s+(test|run\s+(test|typecheck|lint|build))(\s+--[\w-]+)?$/i,
  /^pnpm\s+(test|run\s+(test|typecheck|lint|build))$/i,
  /^yarn\s+(test|lint|build)$/i,
  /^pytest(\s+[\w./-]+)?$/i,
  /^python\s+-m\s+pytest(\s+[\w./-]+)?$/i,
  /^tsc\s+(-p\s+[\w./-]+)?\s*(--noEmit)?$/i,
  /^eslint\s+[\w./-]+$/i,
  /^ruff\s+check\s+[\w./-]+$/i,
  /^git\s+(status|diff|log)(\s+.*)?$/i,
];

export function decideCommand(cmd: string, mode: AutoRunMode): CommandDecision {
  const trimmed = cmd.trim();

  if (!trimmed) return { decision: "deny", reason: "empty command" };
  if (mode === "off") return { decision: "deny", reason: "auto-run disabled" };

  const safe = SAFE_COMMANDS.some((re) => re.test(trimmed));

  if (mode === "safe") {
    return safe
      ? { decision: "allow", reason: "allowlisted verification command" }
      : { decision: "ask", reason: "not in safe allowlist" };
  }

  return { decision: "ask", reason: "auto-run in ask mode" };
}
