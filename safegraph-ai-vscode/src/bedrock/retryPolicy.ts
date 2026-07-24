/**
 * retryPolicy.ts
 *
 * Implements retry rules and exponential backoff with full jitter for Bedrock calls.
 */

import { EmptyStreamError } from "./bedrockErrors";

export interface RetryOptions {
  maxRetries: number;
  signal?: AbortSignal;
}

const NON_RETRYABLE_NAMES = new Set([
  "ValidationException",
  "AccessDeniedException",
  "ResourceNotFoundException",
  "ExpiredTokenException",
  "UnrecognizedClientException",
  "InvalidSignatureException",
  "AbortError",
  "BedrockConfigurationError",
  "EmptyStreamError",
]);

const RETRYABLE_NAMES = new Set([
  "ThrottlingException",
  "TooManyRequestsException",
  "ServiceUnavailableException",
  "InternalServerException",
  "ModelNotReadyException",
]);

export function isAbortError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof Error) {
    if (error.name === "AbortError" || error.message.toLowerCase().includes("aborted")) {
      return true;
    }
  }
  const err = error as { name?: string; message?: string };
  return err.name === "AbortError" || String(err.message || "").toLowerCase().includes("aborted");
}

export function getErrorName(error: unknown): string {
  if (!error) return "";
  const err = error as { name?: string; code?: string };
  return err.name || err.code || "";
}

export function getHttpStatus(error: unknown): number | undefined {
  if (!error) return undefined;
  const err = error as { statusCode?: number; status?: number; $metadata?: { httpStatusCode?: number }; message?: string };

  if (typeof err.statusCode === "number") return err.statusCode;
  if (typeof err.status === "number") return err.status;
  if (typeof err.$metadata?.httpStatusCode === "number") return err.$metadata.httpStatusCode;

  // Check message for HTTP status codes e.g. "Bedrock 429" or "HTTP 503"
  const match = String(err.message || "").match(/(?:Bedrock|HTTP|status)\s+([45]\d\d)/i);
  if (match) {
    return parseInt(match[1], 10);
  }
  return undefined;
}

export function isTransientNetworkError(error: unknown): boolean {
  if (!error) return false;
  const str = String(error instanceof Error ? error.message : error);
  const code = (error as { code?: string }).code || "";
  return (
    /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up/i.test(str) ||
    /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND/i.test(code)
  );
}

export function isRetryableBedrockError(error: unknown): boolean {
  if (isAbortError(error)) {
    return false;
  }

  if (error instanceof EmptyStreamError) {
    return false;
  }

  const name = getErrorName(error);

  if (NON_RETRYABLE_NAMES.has(name)) {
    return false;
  }

  if (RETRYABLE_NAMES.has(name)) {
    return true;
  }

  const status = getHttpStatus(error);

  if (status === 429) {
    return true;
  }

  if (status !== undefined) {
    return status >= 500 && status <= 599;
  }

  return isTransientNetworkError(error);
}

/**
 * Exponential backoff with full jitter.
 */
export function calculateRetryDelay(
  attempt: number,
  baseDelayMs = 500,
  maximumDelayMs = 8_000,
): number {
  const ceiling = Math.min(maximumDelayMs, baseDelayMs * 2 ** attempt);
  return Math.floor(Math.random() * ceiling);
}

/**
 * Abortable sleep.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new Error("aborted"));
    }

    let timer: NodeJS.Timeout | undefined;

    const onAbort = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("aborted"));
    };

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    timer = setTimeout(() => {
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
  });
}

/**
 * Retry wrapper.
 */
export async function withBedrockRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= options.maxRetries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt >= options.maxRetries || !isRetryableBedrockError(error)) {
        throw error;
      }

      await sleep(calculateRetryDelay(attempt), options.signal);
    }
  }

  throw lastError;
}
