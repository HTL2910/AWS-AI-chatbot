import * as vscode from "vscode";
import { getBedrockModelConfig, hasBedrockCredentials } from "./bedrock";
import { isLocalBaseUrl } from "../providers/openaiChat";
import {
  BEDROCK_MODEL_SUGGESTIONS,
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_MODEL,
  OPENAI_MODEL_SUGGESTIONS
} from "../providers/catalog";
import type { ProviderId } from "../providers/types";

export const SECRET_OPENAI_API_KEY = "safegraph.openaiApiKey";

export type OpenAISettings = {
  baseUrl: string;
  model: string;
  apiKey: string;
  /** Local 9Router / LiteLLM can run without a key. */
  allowEmptyKey: boolean;
};

export function getProviderId(): ProviderId {
  const value = vscode.workspace.getConfiguration("safegraph").get<string>("provider");
  return value === "openai-compatible" ? "openai-compatible" : "bedrock";
}

export function readOpenAIBaseUrl(): string {
  const value = vscode.workspace.getConfiguration("safegraph").get<string>("openaiBaseUrl");
  return typeof value === "string" && value.trim() ? value.trim() : DEFAULT_OPENAI_BASE_URL;
}

export function readOpenAIModel(): string {
  const value = vscode.workspace.getConfiguration("safegraph").get<string>("openaiModel");
  return typeof value === "string" && value.trim() ? value.trim() : DEFAULT_OPENAI_MODEL;
}

/**
 * API keys live in SecretStorage. If a user pasted one into settings, move it
 * into SecretStorage and clear the setting so it is not written to settings.json.
 */
export async function resolveOpenAIApiKey(
  context: vscode.ExtensionContext,
  output?: vscode.OutputChannel
): Promise<string> {
  let key = ((await context.secrets.get(SECRET_OPENAI_API_KEY)) || "").trim();
  if (key) return key;
  const fromSetting = (vscode.workspace.getConfiguration("safegraph").get<string>("openaiApiKey") || "").trim();
  if (!fromSetting) return "";
  await context.secrets.store(SECRET_OPENAI_API_KEY, fromSetting);
  await vscode.workspace.getConfiguration("safegraph").update("openaiApiKey", "", vscode.ConfigurationTarget.Global);
  output?.appendLine("[safegraph-ai] moved safegraph.openaiApiKey from settings into SecretStorage");
  key = fromSetting;
  return key;
}

export async function resolveOpenAISettings(
  context: vscode.ExtensionContext,
  output?: vscode.OutputChannel
): Promise<OpenAISettings> {
  const baseUrl = readOpenAIBaseUrl();
  const apiKey = await resolveOpenAIApiKey(context, output);
  return {
    baseUrl,
    model: readOpenAIModel(),
    apiKey,
    allowEmptyKey: isLocalBaseUrl(baseUrl)
  };
}

export async function hasModelCredentials(context: vscode.ExtensionContext): Promise<boolean> {
  if (getProviderId() === "openai-compatible") {
    const settings = await resolveOpenAISettings(context);
    return Boolean(settings.apiKey) || settings.allowEmptyKey;
  }
  return hasBedrockCredentials(context);
}

export function missingCredentialsMessage(provider: ProviderId = getProviderId()): string {
  if (provider === "openai-compatible") {
    return "No API key is stored for the OpenAI-compatible provider. Open Safegraph AI: Setup, choose OpenAI-compatible, and enter the base URL plus API key. 9Router's default is http://localhost:20128/v1 (a key is optional on localhost).";
  }
  return "AWS credentials are not configured. Click the key icon in the chat header (or run 'Safegraph AI: Setup') to enter a Bedrock API key or AWS access keys.";
}

export function modelSuggestions(provider: ProviderId): string[] {
  return provider === "openai-compatible" ? [...OPENAI_MODEL_SUGGESTIONS] : [...BEDROCK_MODEL_SUGGESTIONS];
}

export function activeModelId(): string {
  return getProviderId() === "openai-compatible" ? readOpenAIModel() : getBedrockModelConfig().modelId;
}
