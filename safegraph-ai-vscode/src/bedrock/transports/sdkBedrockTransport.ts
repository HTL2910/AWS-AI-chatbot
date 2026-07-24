/**
 * SdkBedrockTransport
 *
 * Implements BedrockTransport using @aws-sdk/client-bedrock-runtime.
 * Supports both default credential chain and named AWS profiles.
 *
 * maxAttempts is always 1 — retry logic lives in retryPolicy.ts.
 * AWS SDK types never leak outside this file.
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { fromIni } from "@aws-sdk/credential-providers";

import type { BedrockTransport } from "./bedrockTransport";
import type {
  BedrockConverseRequest,
  BedrockConverseResponse,
  BedrockStreamEvent,
  BedrockContentBlock,
} from "../bedrockTypes";
import { EmptyStreamError } from "../bedrockErrors";

// ── SDK command input builder ─────────────────────────────────────────────────

function buildCommandInput(request: BedrockConverseRequest): Record<string, unknown> {
  const inferenceConfig: Record<string, unknown> = {
    maxTokens: request.maxTokens ?? 2048,
    temperature: request.temperature ?? 0.3,
  };
  if (typeof request.topP === "number") {
    inferenceConfig.topP = request.topP;
  }
  if (request.stopSequences && request.stopSequences.length > 0) {
    inferenceConfig.stopSequences = request.stopSequences.slice(0, 4);
  }

  const input: Record<string, unknown> = {
    modelId: request.modelId,
    messages: request.messages,
    inferenceConfig,
  };
  if (request.system?.trim()) {
    input.system = [{ text: request.system.trim() }];
  }
  if (request.toolConfig) {
    input.toolConfig = request.toolConfig;
  }
  return input;
}

// ── SDK output mappers (AWS SDK types stay here) ──────────────────────────────

function mapSdkConverseResponse(response: any): BedrockConverseResponse {
  const content: any[] = response.output?.message?.content ?? [];
  const stopReason = String(response.stopReason || "").toLowerCase();
  const text = content
    .map((c: any) => c?.text)
    .filter(Boolean)
    .join("\n");
  return { text, stopReason, raw: response };
}

function mapSdkContentBlock(block: any): BedrockContentBlock {
  if (block?.toolUse) {
    return {
      toolUse: {
        toolUseId: String(block.toolUse.toolUseId || ""),
        name: String(block.toolUse.name || ""),
        input: block.toolUse.input ?? {},
      },
    };
  }
  return { text: String(block?.text || "") };
}

// ── Transport implementation ──────────────────────────────────────────────────

export class SdkBedrockTransport implements BedrockTransport {
  private readonly profile: string | undefined;
  private readonly region: string;

  constructor({ region, profile }: { region: string; profile?: string }) {
    this.region = region;
    this.profile = profile;
  }

  private createClient(): BedrockRuntimeClient {
    return new BedrockRuntimeClient({
      region: this.region,
      credentials: this.profile ? fromIni({ profile: this.profile }) : undefined,
      maxAttempts: 1, // SafeGraph handles its own retries via retryPolicy.ts
    });
  }

  // ── Non-streaming ──────────────────────────────────────────────────────────

  async converse(
    request: BedrockConverseRequest,
    signal?: AbortSignal,
  ): Promise<BedrockConverseResponse> {
    const client = this.createClient();
    try {
      const command = new ConverseCommand(buildCommandInput(request) as any);
      const response = await client.send(command, { abortSignal: signal as any });
      return mapSdkConverseResponse(response);
    } finally {
      client.destroy();
    }
  }

  // ── Streaming ──────────────────────────────────────────────────────────────

  async *converseStream(
    request: BedrockConverseRequest,
    signal?: AbortSignal,
  ): AsyncIterable<BedrockStreamEvent> {
    const client = this.createClient();
    try {
      const command = new ConverseStreamCommand(buildCommandInput(request) as any);
      const response = await client.send(command, { abortSignal: signal as any });

      let fullText = "";
      let stopReason = "";
      const blocks: any[] = [];
      const events: unknown[] = [];

      if (!response.stream) return;

      for await (const chunk of response.stream) {
        events.push(chunk);

        // Content block start (signals start of a tool-use block)
        if (chunk.contentBlockStart?.start?.toolUse) {
          const idx = chunk.contentBlockStart.contentBlockIndex ?? blocks.length;
          const { toolUseId, name } = chunk.contentBlockStart.start.toolUse;
          blocks[idx] = { toolUse: { toolUseId, name, input: "" } };
          yield {
            type: "content_block_start",
            index: idx,
            toolUseId: toolUseId ? String(toolUseId) : undefined,
            toolName: name ? String(name) : undefined,
          };

        } else if (chunk.contentBlockStart) {
          const idx = chunk.contentBlockStart.contentBlockIndex ?? blocks.length;
          if (!blocks[idx]) blocks[idx] = { text: "" };
        }

        // Content delta
        if (chunk.contentBlockDelta) {
          const idx = chunk.contentBlockDelta.contentBlockIndex ?? 0;
          if (!blocks[idx]) blocks[idx] = { text: "" };

          const delta = chunk.contentBlockDelta.delta;

          if (typeof delta?.text === "string") {
            blocks[idx].text = String(blocks[idx].text || "") + delta.text;
            fullText += delta.text;
            yield { type: "text_delta", text: delta.text, fullText };
          }

          if (delta?.toolUse) {
            const existing = blocks[idx].toolUse ?? { input: "" };
            existing.input = String(existing.input || "") + String(delta.toolUse.input || "");
            blocks[idx].toolUse = existing;
            yield {
              type: "tool_use_delta",
              index: idx,
              inputChunk: String(delta.toolUse.input || ""),
            };
          }
        }

        // Stop
        if (chunk.messageStop?.stopReason) {
          stopReason = String(chunk.messageStop.stopReason).toLowerCase();
          yield { type: "stop", stopReason };
        }
      }

      // Finalize tool-use inputs (parse JSON string -> object)
      const content: BedrockContentBlock[] = blocks.filter(Boolean).map((b: any) => {
        if (b.toolUse) {
          const rawInput = String(b.toolUse.input || "").trim();
          let input: unknown = {};
          if (rawInput) {
            try { input = JSON.parse(rawInput); } catch { input = rawInput; }
          }
          return { toolUse: { ...b.toolUse, input } } as BedrockContentBlock;
        }
        return mapSdkContentBlock(b);
      });

      const hasToolUse = content.some((c) => "toolUse" in c);
      if (!fullText.trim() && !hasToolUse) {
        throw new EmptyStreamError(events.length);
      }
    } catch (err) {
      yield { type: "error", error: err as Error };
      throw err;
    } finally {
      client.destroy();
    }
  }
}
