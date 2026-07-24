/**
 * bedrockClient.ts — Orchestrator
 *
 * Public API is backward-compatible with callers such as ChatViewProvider.
 * All transport-specific logic lives in:
 *   - transports/bearerBedrockTransport.ts
 *   - transports/sdkBedrockTransport.ts
 *
 * This module:
 *   1. Validates configuration (fail-fast).
 *   2. Normalises input into BedrockConverseRequest.
 *   3. Resolves the correct transport via authResolver (no heuristics).
 *   4. Wraps stream events into the legacy callback shape (onText).
 *   5. Runs the retry loop via retryPolicy.withRetry.
 */

import type { BedrockConverseRequest, BedrockMessage, BedrockStreamEvent } from "./bedrockTypes";
import { resolveBedrockTransport } from "./authResolver";
import type { BedrockAuthMode } from "./authResolver";
import { withRetry } from "./retryPolicy";
import { isExpiredBearerTokenError, BedrockConfigurationError } from "./bedrockErrors";

// ── Re-exported types (keeps legacy import paths working) ────────────────────

export type BedrockConverseOptions = {
  region: string;
  modelId: string;
  /** Bearer token. When absent, falls back to AWS SDK credential chain. */
  apiKey?: string;
  /** Explicit auth mode; defaults to "auto". */
  authMode?: BedrockAuthMode;
  /** Named AWS profile (used when authMode is "aws-credentials" or "auto" without token). */
  awsProfile?: string;
  system?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  signal?: AbortSignal;
  retries?: number;
  toolConfig?: unknown;
};

export type BedrockConverseResult = {
  text: string;
  stopReason: string;
  raw: unknown;
};

export type BedrockConverseStreamCallbacks = {
  onText?: (text: string, fullText: string) => void | Promise<void>;
};

// Re-export so callers that imported from here still work.
export { isExpiredBearerTokenError, BedrockConfigurationError };

// ── Phase 5: Fail-fast configuration validation ───────────────────────────────

export interface BedrockClientOptions {
  region: string;
  modelId: string;
}

/**
 * Validates the minimum configuration required to make any Bedrock call.
 * Throws BedrockConfigurationError with a clear, actionable message.
 */
export function validateBedrockConfiguration(options: BedrockClientOptions): void {
  if (!options.region.trim()) {
    throw new BedrockConfigurationError("Amazon Bedrock region is not configured.");
  }

  if (!options.modelId.trim()) {
    throw new BedrockConfigurationError(
      "No Bedrock model is configured.\n\n" +
      "Open Settings and configure:\n" +
      "  safegraph.modelId\n\n" +
      "You may use a Bedrock model ID or inference profile ARN.",
    );
  }
}

// ── Input normalisation ───────────────────────────────────────────────────────

type LegacyInput =
  | string
  | { role: "user" | "assistant"; text?: string; content?: unknown[] }[];

function normalizeToRequest(
  input: LegacyInput,
  options: BedrockConverseOptions,
): BedrockConverseRequest {
  let messages: BedrockMessage[];
  if (typeof input === "string") {
    messages = [{ role: "user", content: [{ text: input }] }];
  } else {
    messages = input.map((m) => ({
      role: m.role,
      content: (m.content ? m.content : [{ text: m.text || "" }]) as any,
    }));
  }

  return {
    modelId: options.modelId,
    region: options.region,
    messages,
    system: options.system,
    maxTokens: options.maxTokens,
    temperature: options.temperature,
    topP: options.topP,
    stopSequences: options.stopSequences,
    toolConfig: options.toolConfig,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function bedrockConverse(
  input: LegacyInput,
  options: BedrockConverseOptions,
): Promise<BedrockConverseResult> {
  validateBedrockConfiguration(options);

  const request = normalizeToRequest(input, options);
  const transport = resolveBedrockTransport({
    authMode: options.authMode ?? "auto",
    bearerToken: options.apiKey,
    awsProfile: options.awsProfile,
    region: options.region,
  });
  const maxRetries = options.retries ?? 2;

  return withRetry(
    () => transport.converse(request, options.signal),
    maxRetries,
  );
}

export async function bedrockConverseStream(
  input: LegacyInput,
  options: BedrockConverseOptions,
  callbacks: BedrockConverseStreamCallbacks = {},
): Promise<BedrockConverseResult> {
  validateBedrockConfiguration(options);

  const request = normalizeToRequest(input, options);
  const transport = resolveBedrockTransport({
    authMode: options.authMode ?? "auto",
    bearerToken: options.apiKey,
    awsProfile: options.awsProfile,
    region: options.region,
  });
  const maxRetries = options.retries ?? 2;

  return withRetry(async () => {
    let fullText = "";
    let stopReason = "";
    let callbackChain = Promise.resolve();

    // Track content blocks so raw.output.message.content is correct for
    // tool_use turns (ChatViewProvider reads rawContent from there).
    const blocks: Record<number, { text?: string; toolUse?: { toolUseId: string; name: string; input: string } }> = {};

    for await (const event of transport.converseStream(request, options.signal) as AsyncIterable<BedrockStreamEvent>) {
      if (event.type === "error") {
        throw event.error;
      }

      if (event.type === "content_block_start") {
        if (event.toolUseId !== undefined) {
          blocks[event.index] = {
            toolUse: { toolUseId: event.toolUseId!, name: event.toolName ?? "", input: "" },
          };
        } else if (blocks[event.index] === undefined) {
          blocks[event.index] = { text: "" };
        }
      }

      if (event.type === "text_delta") {
        fullText = event.fullText;
        // Find the current text block and update it so raw is consistent.
        const textBlockKey = Object.keys(blocks).find(
          (k) => blocks[Number(k)]?.text !== undefined,
        );
        const idx = textBlockKey !== undefined ? Number(textBlockKey) : 0;
        if (!blocks[idx]) blocks[idx] = { text: "" };
        blocks[idx].text = (blocks[idx].text ?? "") + event.text;

        if (callbacks.onText) {
          const delta = event.text;
          const snapshot = event.fullText;
          callbackChain = callbackChain
            .then(() => callbacks.onText!(delta, snapshot))
            .then(() => undefined);
        }
      }

      if (event.type === "tool_use_delta") {
        const block = blocks[event.index];
        if (block?.toolUse) {
          block.toolUse.input += event.inputChunk;
        }
      }

      if (event.type === "stop") {
        stopReason = event.stopReason;
      }
    }

    await callbackChain;

    // Finalize tool-use input JSON strings -> objects
    const content = Object.keys(blocks)
      .map(Number)
      .sort((a, b) => a - b)
      .map((idx) => {
        const b = blocks[idx];
        if (b?.toolUse) {
          const rawInput = b.toolUse.input.trim();
          let input: unknown = {};
          if (rawInput) {
            try { input = JSON.parse(rawInput); } catch { input = rawInput; }
          }
          return { toolUse: { toolUseId: b.toolUse.toolUseId, name: b.toolUse.name, input } };
        }
        return { text: b?.text ?? "" };
      });

    return {
      text: fullText,
      stopReason,
      raw: { output: { message: { content } }, stopReason },
    };
  }, maxRetries);
}

export async function bedrockConverseText(
  userText: string,
  options: BedrockConverseOptions,
): Promise<string> {
  const r = await bedrockConverse(userText, options);
  return r.text;
}
