/**
 * Retry policy for Bedrock calls.
 *
 * Separating this from the transport lets us test the policy independently
 * and avoids duplicating the same logic in both transport classes.
 */

import { isUnusableCompletedStreamError, EmptyStreamError } from "./bedrockErrors";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "";
}

/**
 * Returns true when the call should be retried.
 *
 * Rules:
 *  - Never retry client errors (4xx except 429).
 *  - Never retry empty-stream: the model returned nothing on purpose.
 *  - Always retry throttling (429), server errors (5xx), and network issues.
 */
export function shouldRetry(error: unknown): boolean {
  if (!error) return false;

  if (error instanceof EmptyStreamError) return false;
  if (isUnusableCompletedStreamError(error)) return false;

  const msg = errorMessage(error);
  const name = errorName(error);

  // Hard client errors — never retry
  if (/Bedrock (400|401|403|404)/.test(msg)) return false;
  if (
    /ValidationException|AccessDeniedException|ResourceNotFoundException|InvalidSignatureException/i.test(msg) ||
    /ValidationException|AccessDeniedException|ResourceNotFoundException|InvalidSignatureException/i.test(name)
  ) {
    return false;
  }

  // Transient errors — always retry
  if (/Bedrock (429|500|502|503|504)/.test(msg)) return true;
  if (
    /ThrottlingException|InternalServerException|ServiceUnavailableException/i.test(msg) ||
    /ThrottlingException|InternalServerException|ServiceUnavailableException/i.test(name)
  ) {
    return true;
  }

  // Network errors
  if (/timeout|ECONNRESET|ETIMEDOUT|ENOTFOUND/i.test(msg)) return true;

  return false;
}

/** Exponential backoff. Caps at 8 seconds. */
export function retryDelayMs(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt), 8000);
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps an async factory in a retry loop.
 * The factory is called with the zero-based attempt index.
 */
export async function withRetry<T>(
  factory: (attempt: number) => Promise<T>,
  maxRetries = 2,
): Promise<T> {
  let lastError: Error = new Error("Unknown error");
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await factory(attempt);
    } catch (err) {
      lastError = err as Error;
      if (!shouldRetry(err) || attempt >= maxRetries) {
        break;
      }
      await sleep(retryDelayMs(attempt));
    }
  }
  throw lastError;
}
