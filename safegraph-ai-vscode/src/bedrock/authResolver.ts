/**
 * AuthResolver — resolves which BedrockTransport to use based on extension config.
 *
 * Priority:
 *  1. If `safegraph.authMode === "bearer-token"` (or a non-empty apiKey is provided),
 *     use BearerBedrockTransport.
 *  2. Otherwise use SdkBedrockTransport (IAM / aws-credentials mode),
 *     optionally with a named profile from `safegraph.awsProfile`.
 */

import * as vscode from "vscode";
import type { BedrockTransport } from "./transports/bedrockTransport";
import { BearerBedrockTransport } from "./transports/bearerBedrockTransport";
import { SdkBedrockTransport } from "./transports/sdkBedrockTransport";

export type AuthMode = "auto" | "aws-credentials" | "bearer-token";

export interface ResolvedTransportConfig {
  transport: BedrockTransport;
  region: string;
  modelId: string;
}

/**
 * Reads the current workspace configuration and returns the appropriate
 * BedrockTransport for this session.
 *
 * @param apiKeyOverride - Optionally pass an in-memory API key (e.g. from
 *   the chat panel input) without touching extension settings.
 */
export function resolveTransport(apiKeyOverride?: string): ResolvedTransportConfig {
  const cfg = vscode.workspace.getConfiguration("safegraph");

  const region = String(cfg.get("region") || "ap-southeast-1");
  const modelId = String(cfg.get("modelId") || "");
  const authMode = String(cfg.get("authMode") || "auto") as AuthMode;
  const awsProfile = String(cfg.get("awsProfile") || "").trim() || undefined;

  // Explicit bearer-token mode OR caller supplied a key directly
  const apiKey = apiKeyOverride?.trim() || String(cfg.get("apiKey") || "").trim();
  const useBearerToken =
    authMode === "bearer-token" || (authMode === "auto" && apiKey.length > 0);

  let transport: BedrockTransport;
  if (useBearerToken) {
    transport = new BearerBedrockTransport(apiKey);
  } else {
    // aws-credentials mode: use SDK + optional profile
    transport = new SdkBedrockTransport({ region, profile: awsProfile });
  }

  return { transport, region, modelId };
}
