const MASK = "***MASKED***";

export function maskSensitive(text: string) {
  let out = text;

  // Bedrock API key patterns
  out = out.replace(/bedrock-api-key-[A-Za-z0-9_-]{16,}/g, MASK);
  out = out.replace(/\bABSK[A-Za-z0-9]{16,}\b/g, MASK);

  // AWS access keys
  out = out.replace(/\bAKIA[0-9A-Z]{16}\b/g, MASK);
  out = out.replace(/\bASIA[0-9A-Z]{16}\b/g, MASK);

  // Generic bearer tokens
  out = out.replace(/Authorization:\s*Bearer\s+[^\s"']+/gi, "Authorization: Bearer " + MASK);

  // Common secrets in env-like text
  out = out.replace(
    /(AWS_SECRET_ACCESS_KEY|SECRET_KEY|PASSWORD|API_KEY)\s*=\s*([^\r\n]+)/gi,
    (_m, k) => `${k}=${MASK}`
  );

  return out;
}

