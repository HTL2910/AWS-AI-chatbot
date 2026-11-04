/**
 * Provider-neutral request types.
 *
 * Chat still speaks the Bedrock content-block shape (text, toolUse, toolResult)
 * because the agent loop already stores that. Each provider adapts it.
 */

export type ProviderId = "bedrock" | "openai-compatible";

export type ProviderContentBlock =
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

export type ProviderTurn = {
  role: "user" | "assistant";
  text?: string;
  content?: ProviderContentBlock[];
};

/** What callers already pass: a prompt string or the agent transcript. */
export type ProviderInput = string | ReadonlyArray<ProviderTurn>;

export type ProviderUsage = {
  inputTokens?: number;
  outputTokens?: number;
};

export type ProviderConverseResult = {
  text: string;
  stopReason: string;
  /**
   * Bedrock-shaped envelope so ChatViewProvider can keep reading
   * `raw.output.message.content` for tool-use turns.
   */
  raw: {
    output: { message: { content: ProviderContentBlock[] } };
    stopReason: string;
    usage?: ProviderUsage;
  };
  usage?: ProviderUsage;
};

export type ProviderStreamCallbacks = {
  onText?: (delta: string, fullText: string) => void | Promise<void>;
};

export type ProviderRequestOptions = {
  modelId: string;
  system?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  signal?: AbortSignal;
  retries?: number;
  /** Bedrock toolConfig, or the same shape built by the chat agent. */
  toolConfig?: unknown;
};

export interface LanguageModelProvider {
  readonly id: ProviderId;
  converse(input: ProviderInput, options: ProviderRequestOptions): Promise<ProviderConverseResult>;
  converseStream(
    input: ProviderInput,
    options: ProviderRequestOptions,
    callbacks?: ProviderStreamCallbacks
  ): Promise<ProviderConverseResult>;
}
