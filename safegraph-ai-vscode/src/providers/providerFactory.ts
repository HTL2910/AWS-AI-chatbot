import * as vscode from "vscode";
import { getBedrockModelConfig, resolveBedrockConnection } from "../config/bedrock";
import { getProviderId, missingCredentialsMessage, resolveOpenAISettings } from "../config/providers";
import { createBedrockProvider } from "./bedrockProvider";
import { ProviderConfigurationError } from "./errors";
import { createOpenAICompatibleProvider } from "./openaiCompatibleProvider";
import type { LanguageModelProvider, ProviderId } from "./types";

export type ModelSession = {
  provider: LanguageModelProvider;
  providerId: ProviderId;
  modelId: string;
  /** Region for Bedrock, base URL for an OpenAI-compatible endpoint. */
  label: string;
};

/**
 * Build the provider selected by `safegraph.provider`.
 * `modelOverride` replaces the saved model for this call (inline completion).
 */
export async function createModelSession(
  context: vscode.ExtensionContext,
  output?: vscode.OutputChannel,
  modelOverride?: string
): Promise<ModelSession> {
  const providerId = getProviderId();
  const override = modelOverride?.trim() || "";
  if (providerId === "openai-compatible") {
    const settings = await resolveOpenAISettings(context, output);
    if (!settings.apiKey && !settings.allowEmptyKey) {
      throw new ProviderConfigurationError(missingCredentialsMessage("openai-compatible"));
    }
    return {
      provider: createOpenAICompatibleProvider({ baseUrl: settings.baseUrl, apiKey: settings.apiKey }),
      providerId,
      modelId: override || settings.model,
      label: settings.baseUrl
    };
  }

  const base = getBedrockModelConfig();
  const connection = await resolveBedrockConnection(
    context,
    output,
    override ? { region: base.region, modelId: override } : base
  );
  return {
    provider: createBedrockProvider(connection, readExtensionVersion(context)),
    providerId,
    modelId: connection.modelId,
    label: connection.region
  };
}

function readExtensionVersion(context: vscode.ExtensionContext): string | undefined {
  const pkg: unknown = context.extension.packageJSON;
  if (!pkg || typeof pkg !== "object") return undefined;
  const version = (pkg as { version?: unknown }).version;
  return typeof version === "string" ? version : undefined;
}
