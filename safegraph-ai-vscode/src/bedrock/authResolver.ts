/**
 * authResolver.ts
 *
 * Resolves which BedrockTransport implementation to use, based on
 * an explicit authMode rather than heuristics on the token string.
 *
 * Rules:
 *  - modelId, bearerToken, and AWS credentials are independent inputs.
 *  - No string inspection (no startsWith, no length checks).
 *  - "auto" mode picks Bearer when a token is present, then explicit access
 *    keys, then the SDK default credential chain / profile.
 */

import { BedrockConfigurationError } from "./bedrockErrors";
import type { BedrockTransport } from "./transports/bedrockTransport";
import { BearerBedrockTransport } from "./transports/bearerBedrockTransport";
import { SdkBedrockTransport } from "./transports/sdkBedrockTransport";
import type { StaticAwsCredentials } from "./transports/sdkBedrockTransport";

export type BedrockAuthMode = "auto" | "aws-credentials" | "bearer-token" | "access-keys";
export type { StaticAwsCredentials };

export interface BedrockAuthOptions {
  authMode: BedrockAuthMode;
  bearerToken?: string;
  awsProfile?: string;
  credentials?: StaticAwsCredentials;
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
          "Run 'Safegraph AI: Setup' (or click the key icon in the chat panel) to enter it.",
        );
      }
      return new BearerBedrockTransport(options.bearerToken.trim(), options.extensionVersion);

    case "access-keys": {
      const creds = options.credentials;
      if (!creds?.accessKeyId?.trim() || !creds.secretAccessKey?.trim()) {
        throw new BedrockConfigurationError(
          "Access-key authentication is selected, but the AWS Access Key ID or Secret Access Key is missing.\n\n" +
          "Run 'Safegraph AI: Setup' to enter them.",
        );
      }
      return new SdkBedrockTransport({
        region: options.region,
        credentials: {
          accessKeyId: creds.accessKeyId.trim(),
          secretAccessKey: creds.secretAccessKey.trim(),
          sessionToken: creds.sessionToken?.trim() || undefined,
        },
      });
    }

    case "aws-credentials":
      return new SdkBedrockTransport({
        region: options.region,
        profile: options.awsProfile?.trim() || undefined,
      });

    case "auto":
      if (options.bearerToken?.trim()) {
        return new BearerBedrockTransport(options.bearerToken.trim(), options.extensionVersion);
      }
      if (options.credentials?.accessKeyId?.trim() && options.credentials.secretAccessKey?.trim()) {
        return resolveBedrockTransport({ ...options, authMode: "access-keys" });
      }
      return new SdkBedrockTransport({
        region: options.region,
        profile: options.awsProfile?.trim() || undefined,
      });

    default:
      return assertNever(options.authMode);
  }
}
