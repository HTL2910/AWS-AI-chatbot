/**
 * Error utilities shared across the Bedrock transport layer.
 */

import type { BedrockConverseResponse } from "./bedrockTypes";

/** Thrown when the extension configuration is incomplete or contradictory. */
export class BedrockConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BedrockConfigurationError";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "";
}

export function isExpiredBearerTokenError(error: unknown): boolean {
  const msg = errorMessage(error);
  return /Bedrock\s+403/i.test(msg) && /Bearer Token has expired/i.test(msg);
}

export function isUnusableCompletedStreamError(error: unknown): boolean {
  return /Bedrock stream completed without usable content/i.test(errorMessage(error));
}

/**
 * Thrown when the stream ends with no meaningful content (no text, no tool-use).
 * Not retriable – the model chose to produce nothing.
 */
export class EmptyStreamError extends Error {
  constructor(eventCount: number, remainingBytes?: number) {
    const detail = remainingBytes !== undefined
      ? `events=${eventCount}, remainingBytes=${remainingBytes}`
      : `events=${eventCount}`;
    super(`Bedrock stream completed without usable content (${detail})`);
    this.name = "EmptyStreamError";
  }
}

/**
 * Thrown for HTTP-level failures on the raw HTTPS transport.
 */
export class BedrockHttpError extends Error {
  constructor(
    public readonly statusCode: number | string,
    body: string,
  ) {
    super(`Bedrock ${statusCode}: ${body.slice(0, 300)}`);
    this.name = "BedrockHttpError";
  }
}

/**
 * Reconstruct a BedrockConverseResponse from finalized content blocks.
 * Used in both transport implementations after stream is fully consumed.
 */
export function buildConverseResponseFromBlocks(
  fullText: string,
  stopReason: string,
  content: unknown[],
  events: unknown[],
): BedrockConverseResponse {
  const text = fullText || (content as any[])
    .map((c: any) => c?.text)
    .filter(Boolean)
    .join("\n");

  return {
    text,
    stopReason,
    raw: { output: { message: { content } }, stopReason, events },
  };
}
