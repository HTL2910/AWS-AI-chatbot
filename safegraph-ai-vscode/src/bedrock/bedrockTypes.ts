/**
 * Internal types shared across the Bedrock transport layer.
 * AWS SDK types MUST NOT leak beyond this boundary.
 */

/** A single content block inside a message. */
export type BedrockContentBlock =
  | { text: string }
  | {
      toolUse: {
        toolUseId: string;
        name: string;
        input: Record<string, unknown>;
      };
    }
  | {
      toolResult: {
        toolUseId: string;
        content: { text: string }[];
        status?: "success" | "error";
      };
    };

export type BedrockMessage = {
  role: "user" | "assistant";
  content: BedrockContentBlock[];
};

/** Normalised request handed to every transport implementation. */
export type BedrockConverseRequest = {
  modelId: string;
  region: string;
  messages: BedrockMessage[];
  system?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  toolConfig?: unknown;
};

/** Normalised response returned by every transport implementation. */
export type BedrockConverseResponse = {
  text: string;
  stopReason: string;
  /** Raw response or synthetic object from stream reconstruction. */
  raw: unknown;
};

/** One logical event emitted by a streaming transport. */
export type BedrockStreamEvent =
  | { type: "text_delta"; text: string; fullText: string }
  | { type: "content_block_start"; index: number; toolUseId?: string; toolName?: string }
  | { type: "tool_use_delta"; index: number; inputChunk: string }
  | { type: "stop"; stopReason: string }
  | { type: "error"; error: Error };
