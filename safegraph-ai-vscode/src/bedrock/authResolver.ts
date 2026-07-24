/**
 * authResolver.ts
 *
 * Resolves which BedrockTransport implementation to use, based on
 * an explicit authMode rather than heuristics on the token string.
 *
 * Rules:
 *  - modelId, bearerToken, and AWS credentials are independent inputs.
 *  - No string inspection (no startsWith, no length checks).
 *  - "auto" mode picks Bearer when a token is present, SDK otherwise.
 */

import { BedrockConfigurationError } from "./bedrockErrors";
import type { BedrockTransport } from "./transports/bedrockTransport";
import { BearerBedrockTransport } from "./transports/bearerBedrockTransport";
import { SdkBedrockTransport } from "./transports/sdkBedrockTransport";

export type BedrockAuthMode = "auto" | "aws-credentials" | "bearer-token";

export interface BedrockAuthOptions {
  authMode: BedrockAuthMode;
  bearerToken?: string;
  awsProfile?: string;
  region: string;
  extensionVersion?: string;
}

/** TypeScript exhaustiveness helper. */
function assertNever(value: never): never {
  throw new Error(`Unhandled authMode: ${String(value)}`);
}

/**
 * Returns the correct BedrockTransport for the given auth options.
 * Throws BedrockConfigurationError when the configuration is self-contradictory.
 */
export function resolveBedrockTransport(options: BedrockAuthOptions): BedrockTransport {
  switch (options.authMode) {
    case "bearer-token":
      if (!options.bearerToken?.trim()) {
        throw new BedrockConfigurationError(
          "Bearer-token authentication is selected, but no Bedrock API key is configured.\n\n" +
          "Add AWS_BEARER_TOKEN_BEDROCK to your workspace .env file, or click 'Set Key' in the chat panel.",
        );
      }
      return new BearerBedrockTransport(options.bearerToken.trim(), options.extensionVersion);

    case "aws-credentials":
      return new SdkBedrockTransport({
        region: options.region,
        profile: options.awsProfile?.trim() || undefined,
      });

    case "auto":
      return options.bearerToken?.trim()
        ? new BearerBedrockTransport(options.bearerToken.trim(), options.extensionVersion)
        : new SdkBedrockTransport({
            region: options.region,
            profile: options.awsProfile?.trim() || undefined,
          });

    default:
      return assertNever(options.authMode);
  }
}
