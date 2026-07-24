/**
 * BearerBedrockTransport
 *
 * Implements BedrockTransport using raw HTTPS requests with
 * "Authorization: Bearer <apiKey>" authentication.
 *
 * This is the original SafeGraph bearer-token mode, extracted verbatim
 * from bedrockClient.ts to maintain exact behaviour parity.
 */

import * as https from "https";
import { ClientRequest } from "http";
import type { BedrockTransport } from "./bedrockTransport";
import type {
  BedrockConverseRequest,
  BedrockConverseResponse,
  BedrockStreamEvent,
  BedrockContentBlock,
} from "../bedrockTypes";
import {
  BedrockHttpError,
  EmptyStreamError,
  buildConverseResponseFromBlocks,
} from "../bedrockErrors";

const USER_AGENT = "safegraph-ai-vscode/0.19.0";
const TIMEOUT_MS = 60_000;

// ── Private helpers ──────────────────────────────────────────────────────────

function buildJsonPayload(request: BedrockConverseRequest): string {
  const inferenceConfig: Record<string, unknown> = {
    maxTokens: request.maxTokens ?? 2048,
    temperature: request.temperature ?? 0.3,
  };
  if (typeof request.topP === "number") {
    inferenceConfig.topP = request.topP;
  }
  if (request.stopSequences && request.stopSequences.length > 0) {
    inferenceConfig.stopSequences = request.stopSequences.slice(0, 4);
  }

  const payload: Record<string, unknown> = {
    messages: request.messages,
    inferenceConfig,
  };
  if (request.system?.trim()) {
    payload.system = [{ text: request.system.trim() }];
  }
  if (request.toolConfig) {
    payload.toolConfig = request.toolConfig;
  }
  return JSON.stringify(payload);
}

function parseEventStreamMessages(buffer: Buffer): {
  messages: { payload: Buffer }[];
  remaining: Buffer;
} {
  const messages: { payload: Buffer }[] = [];
  let offset = 0;

  while (buffer.length - offset >= 16) {
    const totalLength = buffer.readUInt32BE(offset);
    const headersLength = buffer.readUInt32BE(offset + 4);
    if (totalLength <= 16 || totalLength > 10_000_000) break;
    if (buffer.length - offset < totalLength) break;

    const payloadStart = offset + 12 + headersLength;
    const payloadEnd = offset + totalLength - 4;
    if (payloadStart <= payloadEnd) {
      messages.push({ payload: buffer.subarray(payloadStart, payloadEnd) });
    }
    offset += totalLength;
  }

  return { messages, remaining: buffer.subarray(offset) };
}

/** Mutates `blocks` and returns incremental text delta (empty string if none). */
function appendEventToBlocks(event: Record<string, unknown>, blocks: Record<string, unknown>[]): string {
  const start = event.contentBlockStart as any;
  if (start) {
    const index = Number(start.contentBlockIndex ?? blocks.length);
    if (start.start?.toolUse) {
      blocks[index] = {
        toolUse: {
          toolUseId: start.start.toolUse.toolUseId,
          name: start.start.toolUse.name,
          input: "",
        },
      };
    } else if (!blocks[index]) {
      blocks[index] = { text: "" };
    }
  }

  const delta = event.contentBlockDelta as any;
  if (!delta) return "";
  const index = Number(delta.contentBlockIndex ?? 0);
  if (!blocks[index]) blocks[index] = { text: "" };

  if (typeof delta.delta?.text === "string") {
    blocks[index] = { text: String((blocks[index] as any).text || "") + delta.delta.text };
    return delta.delta.text;
  }

  if (delta.delta?.toolUse) {
    const existing = (blocks[index] as any).toolUse ?? { input: "" };
    existing.input = String(existing.input || "") + String(delta.delta.toolUse.input || "");
    blocks[index] = { toolUse: existing };
  }

  return "";
}

function finalizeBlocks(blocks: Record<string, unknown>[]): BedrockContentBlock[] {
  return blocks.filter(Boolean).map((block: any) => {
    if (block.toolUse) {
      const rawInput = String(block.toolUse.input || "").trim();
      let input: unknown = {};
      if (rawInput) {
        try { input = JSON.parse(rawInput); } catch { input = rawInput; }
      }
      return { toolUse: { ...block.toolUse, input } } as BedrockContentBlock;
    }
    return { text: String(block.text || "") } as BedrockContentBlock;
  });
}

function makeRequestOptions(
  method: "POST",
  region: string,
  modelId: string,
  path: string,
  apiKey: string,
  payloadLength: number,
): https.RequestOptions {
  return {
    method,
    hostname: `bedrock-runtime.${region}.amazonaws.com`,
    path: `/model/${encodeURIComponent(modelId)}/${path}`,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Content-Length": payloadLength,
      "User-Agent": USER_AGENT,
    },
    timeout: TIMEOUT_MS,
  };
}

function attachAbort(req: ClientRequest, signal?: AbortSignal): void {
  if (!signal) return;
  const onAbort = () => req.destroy(new Error("aborted"));
  if (signal.aborted) {
    onAbort();
  } else {
    signal.addEventListener("abort", onAbort, { once: true });
  }
}

// ── Transport implementation ─────────────────────────────────────────────────

export class BearerBedrockTransport implements BedrockTransport {
  constructor(private readonly apiKey: string) {}

  // ── Non-streaming ──────────────────────────────────────────────────────────

  async converse(
    request: BedrockConverseRequest,
    signal?: AbortSignal,
  ): Promise<BedrockConverseResponse> {
    const payload = buildJsonPayload(request);
    const reqOptions = makeRequestOptions(
      "POST",
      request.region,
      request.modelId,
      "converse",
      this.apiKey,
      Buffer.byteLength(payload),
    );

    const raw = await new Promise<string>((resolve, reject) => {
      const req = https.request(reqOptions, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (d: Buffer | string) =>
          chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)),
        );
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            resolve(body);
          } else {
            reject(new BedrockHttpError(status, body));
          }
        });
      });
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy(new Error("Bedrock request timeout"));
        reject(new Error("Bedrock request timeout (60s)"));
      });
      attachAbort(req, signal);
      req.write(payload);
      req.end();
    });

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const content = (parsed.output as any)?.message?.content;
    const stopReason = String(
      (parsed as any).stopReason || (parsed as any).stop_reason || "",
    ).toLowerCase();

    if (Array.isArray(content)) {
      const text = content
        .map((c: any) => c?.text)
        .filter(Boolean)
        .join("\n");
      return { text, stopReason, raw: parsed };
    }
    return { text: raw, stopReason, raw: parsed };
  }

  // ── Streaming ──────────────────────────────────────────────────────────────

  async *converseStream(
    request: BedrockConverseRequest,
    signal?: AbortSignal,
  ): AsyncIterable<BedrockStreamEvent> {
    const payload = buildJsonPayload(request);
    const reqOptions = makeRequestOptions(
      "POST",
      request.region,
      request.modelId,
      "converse-stream",
      this.apiKey,
      Buffer.byteLength(payload),
    );

    // We wrap the callback-based https stream in an async generator using
    // an intermediate event queue so we can yield within the generator.
    interface QueueEvent {
      kind: "streamEvent" | "end" | "error";
      event?: Record<string, unknown>;
      error?: Error;
      statusCode?: number;
      nonSuccessBody?: string;
    }

    const queue: QueueEvent[] = [];
    let resolve: (() => void) | null = null;
    let done = false;

    const notify = () => {
      if (resolve) {
        const r = resolve;
        resolve = null;
        r();
      }
    };

    const req = https.request(reqOptions, (res) => {
      let pending: Buffer = Buffer.alloc(0);
      const statusCode = res.statusCode ?? 0;
      let nonSuccessBody = "";

      res.on("data", (chunk: Buffer | string) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (statusCode < 200 || statusCode >= 300) {
          nonSuccessBody += buf.toString("utf8");
          return;
        }

        pending = Buffer.concat([pending, buf]);
        const parsed = parseEventStreamMessages(pending);
        pending = parsed.remaining;

        for (const item of parsed.messages) {
          const rawPayload = item.payload.toString("utf8").trim();
          if (!rawPayload) continue;
          let event: Record<string, unknown>;
          try {
            event = JSON.parse(rawPayload) as Record<string, unknown>;
          } catch {
            continue;
          }
          queue.push({ kind: "streamEvent", event });
          notify();
        }
      });

      res.on("end", () => {
        if (statusCode < 200 || statusCode >= 300) {
          queue.push({ kind: "error", error: new BedrockHttpError(statusCode, nonSuccessBody) });
        } else {
          queue.push({ kind: "end" });
        }
        done = true;
        notify();
      });
    });

    req.on("error", (err: Error) => {
      queue.push({ kind: "error", error: err });
      done = true;
      notify();
    });
    req.on("timeout", () => {
      const err = new Error("Bedrock request timeout (60s)");
      req.destroy(err);
      queue.push({ kind: "error", error: err });
      done = true;
      notify();
    });
    attachAbort(req, signal);
    req.write(payload);
    req.end();

    // ── Consume the queue as an async generator ────────────────────────────
    const blocks: Record<string, unknown>[] = [];
    const events: Record<string, unknown>[] = [];
    let fullText = "";
    let stopReason = "";

    const wait = () =>
      new Promise<void>((res) => {
        resolve = res;
      });

    while (true) {
      if (queue.length === 0) {
        if (done) break;
        await wait();
        continue;
      }

      const item = queue.shift()!;

      if (item.kind === "error") {
        yield { type: "error", error: item.error! };
        throw item.error;
      }

      if (item.kind === "end") {
        break;
      }

      // kind === "streamEvent"
      const event = item.event!;

      // Surface stream-level errors from Bedrock
      if (
        event.internalServerException ||
        event.modelStreamErrorException ||
        event.throttlingException ||
        event.validationException ||
        event.serviceUnavailableException
      ) {
        const err = new Error(`Bedrock stream error: ${JSON.stringify(event).slice(0, 300)}`);
        yield { type: "error", error: err };
        throw err;
      }

      events.push(event);

      // Content block start (signals tool-use opening)
      const blockStart = event.contentBlockStart as any;
      if (blockStart?.start?.toolUse) {
        const idx = Number(blockStart.contentBlockIndex ?? blocks.length);
        yield {
          type: "content_block_start",
          index: idx,
          toolUseId: blockStart.start.toolUse.toolUseId,
          toolName: blockStart.start.toolUse.name,
        };
      }

      const stopEvent = event.messageStop as any;
      if (stopEvent?.stopReason) {
        stopReason = String(stopEvent.stopReason).toLowerCase();
        yield { type: "stop", stopReason };
      }

      const deltaText = appendEventToBlocks(event, blocks);
      if (deltaText) {
        fullText += deltaText;
        yield { type: "text_delta", text: deltaText, fullText };
      }

      // Tool use delta
      const delta = event.contentBlockDelta as any;
      if (delta?.delta?.toolUse) {
        yield {
          type: "tool_use_delta",
          index: Number(delta.contentBlockIndex ?? 0),
          inputChunk: String(delta.delta.toolUse.input || ""),
        };
      }
    }

    const content = finalizeBlocks(blocks);
    const hasToolUse = content.some((c) => "toolUse" in c);
    if (!fullText.trim() && !hasToolUse) {
      throw new EmptyStreamError(events.length);
    }
  }
}
