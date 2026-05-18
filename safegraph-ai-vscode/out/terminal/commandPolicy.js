"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decideCommand = decideCommand;
const DANGEROUS_TOKENS = [
    /(^|\s)(rm|del|rmdir|Remove-Item)\b/i,
    /(^|\s)(git\s+push|git\s+reset|git\s+clean)\b/i,
    /(^|\s)(curl|wget|Invoke-WebRequest|iwr)\b/i,
    /(^|\s)(chmod|chown|icacls)\b/i,
    /(^|\s)(shutdown|reboot)\b/i
];
// Commands we consider low-risk to auto-run (still no shell chaining).
const SAFE_PREFIXES = [
    /^npm\s+(i|install|ci)\b/i,
    /^npm\s+run\s+\S+/i,
    /^pnpm\s+(i|install)\b/i,
    /^pnpm\s+run\s+\S+/i,
    /^yarn\s+(install|add)\b/i,
    /^yarn\s+run\s+\S+/i,
    /^pip\s+install\b/i,
    /^python\s+-m\s+pip\s+install\b/i,
    /^pytest\b/i,
    /^tsc\b/i,
    /^node\s+\S+/i
];
function hasShellChaining(cmd) {
    return /[;&|]{1,2}/.test(cmd);
}
function decideCommand(cmd, mode) {
    const trimmed = cmd.trim();
    if (!trimmed)
        return { decision: "deny", reason: "empty command" };
    if (hasShellChaining(trimmed)) {
        return { decision: "ask", reason: "shell chaining detected (;, &&, ||, |)" };
    }
    for (const re of DANGEROUS_TOKENS) {
        if (re.test(trimmed)) {
            return mode === "ask"
                ? { decision: "ask", reason: "potentially destructive command" }
                : { decision: "deny", reason: "potentially destructive command" };
        }
    }
    const safe = SAFE_PREFIXES.some((re) => re.test(trimmed));
    if (mode === "off")
        return { decision: "deny", reason: "auto-run disabled" };
    if (mode === "safe") {
        return safe ? { decision: "allow", reason: "safe allowlist" } : { decision: "ask", reason: "not allowlisted" };
    }
    return { decision: "ask", reason: "auto-run mode ask" };
}
