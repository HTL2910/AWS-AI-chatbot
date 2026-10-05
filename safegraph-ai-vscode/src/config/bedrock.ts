import * as vscode from "vscode";
import { loadBedrockApiKeyFromDotEnv } from "./env";
import type { BedrockAuthMode, StaticAwsCredentials } from "../bedrock/authResolver";

/**
 * Canonical Claude Haiku 4.5 model id on Amazon Bedrock (global cross-region
 * inference profile).
 */
export const HAIKU_45_MODEL_ID = "global.anthropic.claude-haiku-4-5-20251001-v1:0";

/** Default chat/agent model used when safegraph.modelId is empty. */
export const DEFAULT_MODEL_ID = HAIKU_45_MODEL_ID;

export const DEFAULT_REGION = "ap-southeast-1";

export const SECRET_KEY_NAME = "safegraph.bedrockApiKey";
export const SECRET_ACCESS_KEY_ID = "safegraph.awsAccessKeyId";
export const SECRET_SECRET_ACCESS_KEY = "safegraph.awsSecretAccessKey";
export const SECRET_SESSION_TOKEN = "safegraph.awsSessionToken";

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
 * Chat configuration type.
 */
export type ChatConfig = {
  region: string;
  modelId: string;
  maxTokens: number;
  temperature: number;
  customSystemPrompt: string;
};

/** Resolve the chat/agent configuration from settings. */
export function getChatConfig(): ChatConfig {
  const cfg = vscode.workspace.getConfiguration("safegraph");
  const base = getBedrockModelConfig();
  return {
    region: base.region,
    modelId: base.modelId,
    maxTokens: clampNumber(cfg.get<number>("chat.maxTokens", 8192), 8192, 256, 16384),
    temperature: clampNumber(cfg.get<number>("chat.temperature", 0.2), 0.2, 0, 1),
    customSystemPrompt: cfg.get<string>("chat.systemPrompt", "").trim()
  };
}

function clampNumber(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

/** Resolve the Bedrock API key from SecretStorage, falling back to a workspace/.env
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

/** Everything a Bedrock call needs besides the prompt. Spread into bedrockConverse options. */
export type BedrockConnection = {
  region: string;
  modelId: string;
  authMode: BedrockAuthMode;
  apiKey?: string;
  awsProfile?: string;
  credentials?: StaticAwsCredentials;
};

export function getAuthMode(): BedrockAuthMode {
  const value = vscode.workspace.getConfiguration("safegraph").get<string>("authMode");
  return value === "bearer-token" || value === "access-keys" || value === "aws-credentials" ? value : "auto";
}

export async function loadStoredAccessKeys(
  context: vscode.ExtensionContext
): Promise<StaticAwsCredentials | undefined> {
  const accessKeyId = ((await context.secrets.get(SECRET_ACCESS_KEY_ID)) || "").trim();
  const secretAccessKey = ((await context.secrets.get(SECRET_SECRET_ACCESS_KEY)) || "").trim();
  if (!accessKeyId || !secretAccessKey) return undefined;
  const sessionToken = ((await context.secrets.get(SECRET_SESSION_TOKEN)) || "").trim();
  return { accessKeyId, secretAccessKey, sessionToken: sessionToken || undefined };
}

/**
 * Resolve the full Bedrock connection (region, model, auth) from settings and
 * SecretStorage. Auth validation happens in the transport resolver, which throws
 * a BedrockConfigurationError with an actionable message when something is missing.
 */
export async function resolveBedrockConnection(
  context: vscode.ExtensionContext,
  output?: vscode.OutputChannel,
  base: BedrockModelConfig = getBedrockModelConfig()
): Promise<BedrockConnection> {
  const authMode = getAuthMode();
  const cfg = vscode.workspace.getConfiguration("safegraph");
  const awsProfile = readString(cfg, "awsProfile", "") || undefined;
  const connection: BedrockConnection = { ...base, authMode, awsProfile };
  if (authMode === "auto" || authMode === "bearer-token") {
    connection.apiKey = (await resolveBedrockApiKey(context, output)) || undefined;
  }
  if (authMode === "auto" || authMode === "access-keys") {
    connection.credentials = await loadStoredAccessKeys(context);
  }
  return connection;
}

/**
 * True when the user has stored some credential, or explicitly chose the AWS
 * credential chain (profile / environment / SSO), which cannot be checked up front.
 */
export async function hasBedrockCredentials(context: vscode.ExtensionContext): Promise<boolean> {
  const authMode = getAuthMode();
  if (authMode === "aws-credentials") return true;
  if (authMode !== "access-keys" && (await resolveBedrockApiKey(context))) return true;
  if (authMode !== "bearer-token" && (await loadStoredAccessKeys(context))) return true;
  return false;
}
