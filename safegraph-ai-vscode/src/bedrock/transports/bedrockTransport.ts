/**
 * BedrockTransport — interface every transport implementation must satisfy.
 *
 * Chat, completion, and inline-edit code talks to this interface only.
 * It has no knowledge of whether the underlying call uses IAM credentials
 * or a Bearer token.
 */

import type {
  BedrockConverseRequest,
  BedrockConverseResponse,
  BedrockStreamEvent,
} from "../bedrockTypes";

export interface BedrockTransport {
  /**
   * Non-streaming completion.
   * Returns the full response once the model finishes.
   */
  converse(
    request: BedrockConverseRequest,
    signal?: AbortSignal,
  ): Promise<BedrockConverseResponse>;

  /**
   * Streaming completion.
   * Yields `BedrockStreamEvent` objects as they arrive.
   * The last event is always type="stop" (or type="error" on failure).
   */
  converseStream(
    request: BedrockConverseRequest,
    signal?: AbortSignal,
  ): AsyncIterable<BedrockStreamEvent>;
}
