import * as https from "https";

export type BedrockConverseOptions = {
  region: string;
  modelId: string;
  apiKey: string;
  system?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  signal?: AbortSignal;
  retries?: number;
  toolConfig?: any;
};

export type BedrockConverseResult = {
  text: string;
  stopReason: string;
  raw: any;
};

export type BedrockConverseStreamCallbacks = {
  onText?: (text: string, fullText: string) => void | Promise<void>;
};

export function isExpiredBearerTokenError(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error);
  return /Bedrock\s+403/i.test(message) && /Bearer Token has expired/i.test(message);
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeMessages(input: string | { role: "user" | "assistant"; text?: string; content?: any[] }[]) {
  return typeof input === "string"
    ? [{ role: "user", content: [{ text: input }] }]
    : input.map((m) => ({
        role: m.role,
        content: m.content ? m.content : [{ text: m.text || "" }]
      }));
}

function buildPayload(
  input: string | { role: "user" | "assistant"; text?: string; content?: any[] }[],
  options: BedrockConverseOptions
) {
  const inferenceConfig: any = {
    maxTokens: options.maxTokens ?? 2048,
    temperature: options.temperature ?? 0.3
  };
  if (typeof options.topP === "number") {
    inferenceConfig.topP = options.topP;
  }
  if (options.stopSequences && options.stopSequences.length > 0) {
    inferenceConfig.stopSequences = options.stopSequences.slice(0, 4);
  }
  const payloadObj: any = {
    messages: normalizeMessages(input),
    inferenceConfig
  };
  if (options.system?.trim()) {
    payloadObj.system = [{ text: options.system.trim() }];
  }
  if (options.toolConfig) {
    payloadObj.toolConfig = options.toolConfig;
  }
  return JSON.stringify(payloadObj);
}

function parseEventStreamMessages(buffer: Buffer) {
  const messages: { payload: Buffer; bytes: number }[] = [];
  let offset = 0;

  while (buffer.length - offset >= 16) {
    const totalLength = buffer.readUInt32BE(offset);
    const headersLength = buffer.readUInt32BE(offset + 4);
    if (totalLength <= 16 || totalLength > 10_000_000) break;
    if (buffer.length - offset < totalLength) break;

    const payloadStart = offset + 12 + headersLength;
    const payloadEnd = offset + totalLength - 4;
    if (payloadStart <= payloadEnd) {
      messages.push({
        payload: buffer.subarray(payloadStart, payloadEnd),
        bytes: totalLength
      });
    }
    offset += totalLength;
  }

  return { messages, remaining: buffer.subarray(offset) };
}

function appendStreamEventToContent(event: any, blocks: any[]) {
  const start = event?.contentBlockStart;
  if (start) {
    const index = Number(start.contentBlockIndex ?? blocks.length);
    if (start.start?.toolUse) {
      blocks[index] = {
        toolUse: {
          toolUseId: start.start.toolUse.toolUseId,
          name: start.start.toolUse.name,
          input: ""
        }
      };
    } else if (!blocks[index]) {
      blocks[index] = { text: "" };
    }
  }

  const delta = event?.contentBlockDelta;
  if (!delta) return "";
  const index = Number(delta.contentBlockIndex ?? 0);
  if (!blocks[index]) blocks[index] = { text: "" };

  if (typeof delta.delta?.text === "string") {
    blocks[index].text = String(blocks[index].text || "") + delta.delta.text;
    return delta.delta.text;
  }

  if (delta.delta?.toolUse) {
    const toolUse = blocks[index].toolUse || { input: "" };
    toolUse.input = String(toolUse.input || "") + String(delta.delta.toolUse.input || "");
    blocks[index].toolUse = toolUse;
  }

  return "";
}

function isUnusableCompletedStream(error: unknown) {
  return /Bedrock stream completed without usable content/i.test(String(error instanceof Error ? error.message : error));
}

function finalizeStreamContent(blocks: any[]) {
  return blocks
    .filter(Boolean)
    .map((block) => {
      if (block.toolUse) {
        const rawInput = String(block.toolUse.input || "").trim();
        let input: any = {};
        if (rawInput) {
          try {
            input = JSON.parse(rawInput);
          } catch {
            input = rawInput;
          }
        }
        return {
          toolUse: {
            ...block.toolUse,
            input
          }
        };
      }
      return { text: String(block.text || "") };
    });
}

export async function bedrockConverse(
  input: string | { role: "user" | "assistant"; text?: string; content?: any[] }[],
  options: BedrockConverseOptions
): Promise<BedrockConverseResult> {
  const region = options.region;
  const modelId = options.modelId;
  const apiKey = options.apiKey;
  const maxRetries = options.retries ?? 2;
  const payload = buildPayload(input, options);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const requestOptions: https.RequestOptions = {
        method: "POST",
        hostname: `bedrock-runtime.${region}.amazonaws.com`,
        path: `/model/${encodeURIComponent(modelId)}/converse`,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          "User-Agent": "safegraph-ai-vscode/0.17.0"
        },
        timeout: 60000
      };

      const raw = await new Promise<string>((resolve, reject) => {
        const req = https.request(requestOptions, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
          res.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf8");
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(body);
              return;
            }
            if (res.statusCode === 429 || res.statusCode === 503) {
              reject(new Error(`Bedrock temporarily unavailable (${res.statusCode}): ${body}`));
              return;
            }
            reject(new Error(`Bedrock ${res.statusCode ?? "ERR"}: ${body.slice(0, 200)}`));
          });
        });
        req.on("error", reject);
        req.on("timeout", () => {
          req.destroy(new Error("Bedrock request timeout"));
          reject(new Error("Bedrock request timeout (60s)"));
        });
        if (options.signal) {
          const onAbort = () => {
            req.destroy(new Error("aborted"));
          };
          if (options.signal.aborted) onAbort();
          else options.signal.addEventListener("abort", onAbort, { once: true });
        }
        req.write(payload);
        req.end();
      });

      const parsed = JSON.parse(raw) as any;
      const content = parsed?.output?.message?.content;
      const stopReason = String(parsed?.stopReason || parsed?.stop_reason || "").toLowerCase();
      if (Array.isArray(content)) {
        const textParts = content.map((c: any) => c?.text).filter(Boolean);
        const text = textParts.join("\n");
        return { text, stopReason, raw: parsed };
      }
      return { text: raw, stopReason, raw: parsed };
    } catch (e) {
      lastError = e as Error;
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
        await sleep(delay);
      }
    }
  }

  throw lastError || new Error("Bedrock request failed after retries");
}

export async function bedrockConverseStream(
  input: string | { role: "user" | "assistant"; text?: string; content?: any[] }[],
  options: BedrockConverseOptions,
  callbacks: BedrockConverseStreamCallbacks = {}
): Promise<BedrockConverseResult> {
  const region = options.region;
  const modelId = options.modelId;
  const apiKey = options.apiKey;
  const maxRetries = options.retries ?? 2;
  const payload = buildPayload(input, options);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const requestOptions: https.RequestOptions = {
        method: "POST",
        hostname: `bedrock-runtime.${region}.amazonaws.com`,
        path: `/model/${encodeURIComponent(modelId)}/converse-stream`,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          "User-Agent": "safegraph-ai-vscode/0.17.0"
        },
        timeout: 60000
      };

      return await new Promise<BedrockConverseResult>((resolve, reject) => {
        let pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);
        let fullText = "";
        let stopReason = "";
        let statusCode = 0;
        let nonSuccessBody = "";
        let callbackChain = Promise.resolve();
        const blocks: any[] = [];
        const events: any[] = [];

        const req = https.request(requestOptions, (res) => {
          statusCode = res.statusCode || 0;

          res.on("data", (chunk) => {
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
              let event: any;
              try {
                event = JSON.parse(rawPayload);
              } catch {
                continue;
              }
              events.push(event);
              if (event.messageStop?.stopReason) {
                stopReason = String(event.messageStop.stopReason).toLowerCase();
              }
              if (event.internalServerException || event.modelStreamErrorException || event.throttlingException || event.validationException || event.serviceUnavailableException) {
                reject(new Error(`Bedrock stream error: ${rawPayload.slice(0, 500)}`));
                return;
              }

              const deltaText = appendStreamEventToContent(event, blocks);
              if (deltaText) {
                fullText += deltaText;
                if (callbacks.onText) {
                  const nextText = fullText;
                  callbackChain = callbackChain.then(() => callbacks.onText?.(deltaText, nextText)).then(() => undefined);
                }
              }
            }
          });

          res.on("end", () => {
            if (statusCode < 200 || statusCode >= 300) {
              reject(new Error(`Bedrock ${statusCode || "ERR"}: ${nonSuccessBody.slice(0, 200)}`));
              return;
            }
            callbackChain
              .then(() => {
                const content = finalizeStreamContent(blocks);
                const text = fullText || content.map((c: any) => c.text).filter(Boolean).join("\n");
                const hasToolUse = content.some((c: any) => c.toolUse);
                if (!text.trim() && !hasToolUse) {
                  reject(
                    new Error(
                      `Bedrock stream completed without usable content (events=${events.length}, remainingBytes=${pending.length})`
                    )
                  );
                  return;
                }
                resolve({
                  text,
                  stopReason,
                  raw: { output: { message: { content } }, stopReason, events }
                });
              })
              .catch(reject);
          });
        });

        req.on("error", reject);
        req.on("timeout", () => {
          req.destroy(new Error("Bedrock request timeout"));
          reject(new Error("Bedrock request timeout (60s)"));
        });
        if (options.signal) {
          const onAbort = () => {
            req.destroy(new Error("aborted"));
          };
          if (options.signal.aborted) onAbort();
          else options.signal.addEventListener("abort", onAbort, { once: true });
        }
        req.write(payload);
        req.end();
      });
    } catch (error) {
      lastError = error as Error;
      if (isUnusableCompletedStream(error)) {
        break;
      }
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
        await sleep(delay);
      }
    }
  }

  throw lastError || new Error("Bedrock stream request failed after retries");
}

export async function bedrockConverseText(userText: string, options: BedrockConverseOptions): Promise<string> {
  const r = await bedrockConverse(userText, options);
  return r.text;
}
