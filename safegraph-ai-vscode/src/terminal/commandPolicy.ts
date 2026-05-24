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

const SENSITIVE_TOKENS = [
  /export\s+[A-Za-z0-9_]*KEY/i,
  /export\s+[A-Za-z0-9_]*TOKEN/i,
  /export\s+[A-Za-z0-9_]*PASSWORD/i,
  /export\s+[A-Za-z0-9_]*SECRET/i,
  /(^|\s)aws\s+configure/i,
  /(^|\s)npm\s+login/i,
  /(^|\s)docker\s+login/i,
  /(^|\s)gh\s+auth\s+login/i,
];



function hasShellChaining(cmd: string) {
  return /[;&|`$(){}[\]]/.test(cmd);
}

function hasRedirection(cmd: string) {
  return /[<>]/.test(cmd) && !cmd.match(/https?:\/\//);
}

function isSafeReadOnlyPipeline(cmd: string) {
  if (!cmd.includes("|")) return false;
  if (/[;&`$(){}[\]<>]/.test(cmd)) return false;

  const parts = cmd.split("|").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return false;

  const readOnlyPart = /^(rg|grep|find|ls|pwd|cat|head|tail|wc)\b/i;
  const firstCanScan = /^(rg|grep|find|ls|pwd|cat)\b/i;
  if (!firstCanScan.test(parts[0])) return false;
  return parts.every((part) => readOnlyPart.test(part));
}

export function decideCommand(cmd: string, mode: AutoRunMode): CommandDecision {
  const trimmed = cmd.trim();
  
  if (!trimmed) {
    return { decision: "deny", reason: "empty command" };
  }

  // Check for shell operators (but allow URLs)
  if (isSafeReadOnlyPipeline(trimmed)) {
    return mode === "safe"
      ? { decision: "allow", reason: "safe read-only inspection pipeline" }
      : mode === "ask"
        ? { decision: "ask", reason: "auto-run in ask mode" }
        : { decision: "deny", reason: "auto-run disabled" };
  }

  if (hasShellChaining(trimmed)) {
    // We allow chaining in safe mode unless it hits a danger token.
    if (mode === "ask" || mode === "off") {
      return { decision: "ask", reason: "shell operators detected (;, &&, ||, |, backticks, $(), etc.)" };
    }
  }

  // Check for redirections (pipes to files, etc)
  if (hasRedirection(trimmed)) {
    if (mode === "ask" || mode === "off") {
      return { decision: "ask", reason: "file redirection detected (>, <, |)" };
    }
  }

  // Check for dangerous patterns
  for (const re of DANGEROUS_TOKENS) {
    if (re.test(trimmed)) {
      return mode === "ask" || mode === "safe"
        ? { decision: "ask", reason: "potentially dangerous command - requires confirmation" }
        : { decision: "deny", reason: "dangerous command blocked" };
    }
  }

  // Check for sensitive patterns
  for (const re of SENSITIVE_TOKENS) {
    if (re.test(trimmed)) {
      return mode === "ask" || mode === "safe"
        ? { decision: "ask", reason: "potentially sensitive info (API keys, accounts)" }
        : { decision: "deny", reason: "sensitive command blocked" };
    }
  }

  if (mode === "off") {
    return { decision: "deny", reason: "auto-run disabled" };
  }
  
  if (mode === "safe") {
    return { decision: "allow", reason: "command looks safe" };
  }
  
  // mode === "ask"
  return { decision: "ask", reason: "auto-run in ask mode" };
}
