import * as vscode from "vscode";
import { loadBedrockApiKeyFromDotEnv } from "./env";

/**
 * Default chat/agent model.
 *
 * The project ships with an application inference profile that resolves to
 * Claude Haiku 4.5 (see https://docs.aws.amazon.com/bedrock/.../claude-haiku-4-5).
 * Keep this as the default so existing users keep their provisioned profile.
 */
export const DEFAULT_MODEL_ID =
  "arn:aws:bedrock:ap-southeast-1:510900713068:application-inference-profile/jxsjbl4xo623";

/**
 * Canonical Claude Haiku 4.5 model id on Amazon Bedrock. Used as a safe fallback
 * for direct model invocation when no inference profile is configured.
 */
export const HAIKU_45_MODEL_ID = "global.anthropic.claude-haiku-4-5-20251001-v1:0";

export const DEFAULT_REGION = "ap-southeast-1";

export const SECRET_KEY_NAME = "safegraph.bedrockApiKey";

export type BedrockModelConfig = {
  region: string;
  modelId: string;
};

export type CompletionConfig = {
  region: string;
  modelId: string;
  enabled: boolean;
  triggerMode: "automatic" | "manual";
  multiline: boolean;
  maxTokens: number;
  debounceMs: number;
};

function readString(cfg: vscode.WorkspaceConfiguration, key: string, fallback: string): string {
  const value = cfg.get<string>(key);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

/** Resolve the chat/agent Bedrock model configuration from settings. */
export function getBedrockModelConfig(): BedrockModelConfig {
  const cfg = vscode.workspace.getConfiguration("safegraph");
  return {
    region: readString(cfg, "region", DEFAULT_REGION),
    modelId: readString(cfg, "modelId", DEFAULT_MODEL_ID)
  };
}

/**
 * Resolve inline-completion configuration. The completion model defaults to the
 * main model (the Haiku 4.5 profile) but can be overridden with a faster/cheaper
 * model via `safegraph.completion.modelId`.
 */
export function getCompletionConfig(): CompletionConfig {
  const cfg = vscode.workspace.getConfiguration("safegraph");
  const base = getBedrockModelConfig();
  const trigger = cfg.get<string>("completion.triggerMode");
  return {
    region: base.region,
    modelId: readString(cfg, "completion.modelId", base.modelId),
    enabled: cfg.get<boolean>("completion.enabled", true),
    triggerMode: trigger === "manual" ? "manual" : "automatic",
    multiline: cfg.get<boolean>("completion.multiline", true),
    maxTokens: cfg.get<number>("completion.maxTokens", 256),
    debounceMs: cfg.get<number>("completion.debounceMs", 300)
  };
}

/**
 * Resolve the Bedrock API key from SecretStorage, falling back to a workspace/.env
 * file. When found in .env, the value is cached in SecretStorage for later calls.
 * This is the single source of truth used by chat, inline edit, and completion.
 */
export async function resolveBedrockApiKey(
  context: vscode.ExtensionContext,
  output?: vscode.OutputChannel
): Promise<string> {
  let apiKey = (await context.secrets.get(SECRET_KEY_NAME)) || "";
  if (!apiKey) {
    const envKey = await loadBedrockApiKeyFromDotEnv([context.extensionUri.fsPath]);
    if (envKey) {
      apiKey = envKey;
      await context.secrets.store(SECRET_KEY_NAME, apiKey);
      output?.appendLine("[safegraph-ai] loaded Bedrock API key from .env into SecretStorage");
    }
  }
  return apiKey;
}
