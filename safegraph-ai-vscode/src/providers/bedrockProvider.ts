import { bedrockConverse, bedrockConverseStream } from "../bedrock/bedrockClient";
import type { BedrockConnection } from "../config/bedrock";
import type { LanguageModelProvider, ProviderConverseResult, ProviderInput, ProviderRequestOptions, ProviderUsage } from "./types";

function asBedrockInput(input: ProviderInput) {
  if (typeof input === "string") return input;
  return input.map((turn) => ({
    role: turn.role,
    text: turn.text,
    content: turn.content
  }));
}

/**
 * Bedrock stays on the existing transports. This wrapper only adapts the
 * shared provider interface and lifts token usage when the raw response has it.
 */
export function createBedrockProvider(connection: BedrockConnection, extensionVersion?: string): LanguageModelProvider {
  const base = {
    region: connection.region,
    modelId: connection.modelId,
    apiKey: connection.apiKey,
    authMode: connection.authMode,
    awsProfile: connection.awsProfile,
    credentials: connection.credentials,
    extensionVersion
  };

  return {
    id: "bedrock",
    async converse(input, options) {
      const result = await bedrockConverse(asBedrockInput(input), toBedrockOptions(base, options));
      const usage = readUsage(result.raw);
      return { text: result.text, stopReason: result.stopReason, raw: asRaw(result.raw, result.stopReason), usage };
    },
    async converseStream(input, options, callbacks) {
      const result = await bedrockConverseStream(asBedrockInput(input), toBedrockOptions(base, options), callbacks);
      const usage = readUsage(result.raw);
      return { text: result.text, stopReason: result.stopReason, raw: asRaw(result.raw, result.stopReason), usage };
    }
  };
}

function toBedrockOptions(
  base: {
    region: string;
    modelId: string;
    apiKey?: string;
    authMode: BedrockConnection["authMode"];
    awsProfile?: string;
    credentials?: BedrockConnection["credentials"];
    extensionVersion?: string;
  },
  options: ProviderRequestOptions
) {
  return {
    ...base,
    modelId: options.modelId || base.modelId,
    system: options.system,
    maxTokens: options.maxTokens,
    temperature: options.temperature,
    topP: options.topP,
    stopSequences: options.stopSequences,
    signal: options.signal,
    retries: options.retries,
    toolConfig: options.toolConfig
  };
}

function asRaw(raw: unknown, stopReason: string): ProviderConverseResult["raw"] {
  const record = asRecord(raw);
  const output = asRecord(record?.output);
  const message = asRecord(output?.message);
  if (message && Array.isArray(message.content)) {
    return raw as ProviderConverseResult["raw"];
  }
  return {
    output: { message: { content: [] } },
    stopReason
  };
}

function readUsage(raw: unknown): ProviderUsage | undefined {
  const record = asRecord(raw);
  const usage = asRecord(record?.usage);
  if (!usage) return undefined;
  const input = typeof usage.inputTokens === "number" ? usage.inputTokens : undefined;
  const output = typeof usage.outputTokens === "number" ? usage.outputTokens : undefined;
  if (input === undefined && output === undefined) return undefined;
  return { inputTokens: input, outputTokens: output };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}
