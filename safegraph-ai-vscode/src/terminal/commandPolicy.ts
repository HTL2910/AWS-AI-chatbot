export type AutoRunMode = "off" | "safe" | "ask";

export type CommandDecision =
  | { decision: "deny"; reason: string }
  | { decision: "ask"; reason: string }
  | { decision: "allow"; reason: string };

const DANGEROUS_TOKENS = [
  /(^|\s)(rm|del|rmdir|Remove-Item)\b/i,
  /(^|\s)(git\s+push|git\s+reset|git\s+clean|git\s+rebase)\b/i,
  /(^|\s)(curl|wget|Invoke-WebRequest|iwr)\s+.*-(o|output|O)\b/i,
  /(^|\s)(chmod|chown|icacls|attrib)\b/i,
  /(^|\s)(shutdown|reboot|restart|halt|poweroff)\b/i,
  /(^|\s)(dd|format|mkfs|wipefs)\b/i,
  /(^|\s)sudo\b/i,
  /(^|\s)(systemctl|service|launchctl)\s+\w+(stop|disable|uninstall)/i
];

// Commands we consider low-risk to auto-run (still no shell chaining).
const SAFE_PREFIXES = [
  /^npm\s+(i|install|ci|ls|list|outdated|audit)\b/i,
  /^npm\s+run\s+[\w-]+(\s+--)?/i,
  /^npx\s+\w+/i,
  /^pnpm\s+(i|install|ci|ls|list)\b/i,
  /^pnpm\s+run\s+[\w-]+/i,
  /^yarn\s+(install|add|upgrade|list|outdated)\b/i,
  /^yarn\s+run\s+[\w-]+/i,
  /^pip\s+(install|show|list|freeze|check)\b/i,
  /^python\s+-m\s+pip\s+(install|show|list|freeze)\b/i,
  /^python3?(?:\.\d+)?\s+-m\s+venv\s+[\w./\-]+$/i,
  /^python3?\s+-m\s+pip/i,
  /^[\w./\-]+\/bin\/python\s+-m\s+pip\s+(install|show|list|freeze|check)\b/i,
  /^[\w./\-]+\/bin\/python\s+-m\s+streamlit\s+run\s+[\w./\-]+/i,
  /^[\w./\-]+\/bin\/python\s+[\w./\-]+\.py\b/i,
  /^pip3?\s+install\b/i,
  /^streamlit\s+run\s+[\w./\-]+/i,
  /^pytest\b/i,
  /^cargo\s+(build|test|run|check)\b/i,
  /^go\s+(build|test|run|mod|get)\b/i,
  /^tsc\b/i,
  /^tsc\s+--/i,
  /^node\s+[\w./\-]+/i,
  /^python3?(?:\.\d+)?\s+[\w./\-]+\.py\b/i,
  /^git\s+(status|log|diff|branch|tag|add|commit|pull|fetch|clone)\b/i,
  /^git\s+config\s+--get\b/i,
  /^ls\b/i,
  /^pwd\b/i,
  /^cat\s+[\w./\-]+/i,
  /^find\s+[\w./\-]+/i,
  /^grep\b/i,
  /^echo\s+/i,
  /^mkdir\s+-p\s+[\w./\-]+/i,
  /^touch\s+[\w./\-]+/i,
  /^make\b/i,
  /^docker\s+(build|run|ps|logs|exec)\b/i,
  /^curl\s+(https?:\/\/|--version|--help)\b/i,
  /^wget\s+https?:\/\//i,
  /^lsof\b/i,
  /^netstat\b/i,
  /^ps\b/i
];

function hasShellChaining(cmd: string) {
  return /[;&|`$(){}[\]]/.test(cmd);
}

function hasRedirection(cmd: string) {
  return /[<>]/.test(cmd) && !cmd.match(/https?:\/\//);
}

export function decideCommand(cmd: string, mode: AutoRunMode): CommandDecision {
  const trimmed = cmd.trim();
  
  if (!trimmed) {
    return { decision: "deny", reason: "empty command" };
  }

  // Check for shell operators (but allow URLs)
  if (hasShellChaining(trimmed)) {
    return { decision: "ask", reason: "shell operators detected (;, &&, ||, |, backticks, $(), etc.)" };
  }

  // Check for redirections (pipes to files, etc)
  if (hasRedirection(trimmed)) {
    return { decision: "ask", reason: "file redirection detected (>, <, |)" };
  }

  // Check for dangerous patterns
  for (const re of DANGEROUS_TOKENS) {
    if (re.test(trimmed)) {
      return mode === "ask" || mode === "safe"
        ? { decision: "ask", reason: "potentially dangerous command - requires confirmation" }
        : { decision: "deny", reason: "dangerous command blocked" };
    }
  }

  // Check for safe commands
  const safe = SAFE_PREFIXES.some((re) => re.test(trimmed));
  
  if (mode === "off") {
    return { decision: "deny", reason: "auto-run disabled" };
  }
  
  if (mode === "safe") {
    return safe 
      ? { decision: "allow", reason: "safe command (allowlisted)" } 
      : { decision: "ask", reason: "not in allowlist - manual confirmation required" };
  }
  
  // mode === "ask"
  return { decision: "ask", reason: "auto-run in ask mode" };
}
