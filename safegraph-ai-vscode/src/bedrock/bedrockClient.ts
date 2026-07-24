/**
 * bedrockClient.ts — Orchestrator
 *
 * Public API is backward-compatible with callers such as ChatViewProvider.
 * All transport-specific logic lives in:
 *   - transports/bearerBedrockTransport.ts
 *   - transports/sdkBedrockTransport.ts
 *
 * This module:
 *   1. Normalises input into BedrockConverseRequest.
 *   2. Chooses the correct transport (Bearer vs SDK) via the apiKey heuristic.
 *   3. Wraps stream events into the legacy callback shape (onText).
 *   4. Runs the retry loop via retryPolicy.withRetry.
 */

import type { BedrockConverseRequest, BedrockMessage, BedrockStreamEvent } from "./bedrockTypes";
import type { BedrockTransport } from "./transports/bedrockTransport";
import { BearerBedrockTransport } from "./transports/bearerBedrockTransport";
import { SdkBedrockTransport } from "./transports/sdkBedrockTransport";
import { withRetry } from "./retryPolicy";
import { isExpiredBearerTokenError } from "./bedrockErrors";

// ── Re-exported types (keeps legacy import paths working) ────────────────────

export type BedrockConverseOptions = {
  region: string;
  modelId: string;
  apiKey?: string;
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

// Re-export so callers that imported isExpiredBearerTokenError from here still work.
export { isExpiredBearerTokenError };

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

// ── Transport selection ───────────────────────────────────────────────────────

function selectTransport(options: BedrockConverseOptions): BedrockTransport {
  if (options.apiKey && options.apiKey.trim().length > 0) {
    return new BearerBedrockTransport(options.apiKey.trim());
  }
  return new SdkBedrockTransport({ region: options.region });
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function bedrockConverse(
  input: LegacyInput,
  options: BedrockConverseOptions,
): Promise<BedrockConverseResult> {
  const request = normalizeToRequest(input, options);
  const transport = selectTransport(options);
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
  const request = normalizeToRequest(input, options);
  const transport = selectTransport(options);
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
        // Also update the text block so raw is consistent
        const textBlockIndex = Object.keys(blocks).findIndex(
          (k) => blocks[Number(k)]?.text !== undefined,
        );
        const idx = textBlockIndex >= 0 ? Number(Object.keys(blocks)[textBlockIndex]) : 0;
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

