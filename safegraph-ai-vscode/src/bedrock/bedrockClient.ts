import * as https from "https";
import { BedrockRuntimeClient, ConverseCommand, ConverseStreamCommand, Message } from "@aws-sdk/client-bedrock-runtime";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";

export type BedrockConverseOptions = {
  region: string;
  modelId: string;
  apiKey?: string;
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

function normalizeMessages(input: string | { role: "user" | "assistant"; text?: string; content?: any[] }[]): Message[] {
  if (typeof input === "string") {
    return [{ role: "user", content: [{ text: input }] }] as any;
  }
  return input.map((m) => ({
    role: m.role,
    content: m.content ? m.content : [{ text: m.text || "" }]
  })) as any;
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

function shouldRetry(error: unknown): boolean {
  if (!error) return false;
  const msg = String(error instanceof Error ? error.message : error);
  const name = error instanceof Error ? error.name : '';

  if (isUnusableCompletedStream(error)) return false;

  // Do not retry client errors (400, 401, 403, 404, etc.)
  if (/Bedrock (400|401|403|404)/.test(msg)) return false;
  if (/ValidationException|AccessDeniedException|ResourceNotFoundException|InvalidSignatureException/i.test(msg) || /ValidationException|AccessDeniedException|ResourceNotFoundException|InvalidSignatureException/i.test(name)) return false;

  // Always retry 429 (Throttling) and 50x (Server Errors)
  if (/Bedrock (429|500|502|503|504)/.test(msg)) return true;
  if (/ThrottlingException|InternalServerException|ServiceUnavailableException/i.test(msg) || /ThrottlingException|InternalServerException|ServiceUnavailableException/i.test(name)) return true;

  // If we can't tell, err on the side of not retrying to avoid loops, unless it's a timeout/network error.
  if (/timeout|ECONNRESET|ETIMEDOUT|ENOTFOUND/i.test(msg)) return true;
  
  // Previously we retried everything, but let's be more restrictive as requested.
  // We'll return false for anything else to avoid broad retries.
  return false;
}

async function awsSdkConverse(
  input: string | { role: "user" | "assistant"; text?: string; content?: any[] }[],
  options: BedrockConverseOptions
): Promise<BedrockConverseResult> {
  const client = new BedrockRuntimeClient({
    region: options.region,
    credentials: fromNodeProviderChain(),
    maxAttempts: 1 // We handle retries manually
  });

  const commandOptions: any = {
    modelId: options.modelId,
    messages: normalizeMessages(input),
    inferenceConfig: {
      maxTokens: options.maxTokens ?? 2048,
      temperature: options.temperature ?? 0.3
    }
  };

  if (typeof options.topP === "number") {
    commandOptions.inferenceConfig.topP = options.topP;
  }
  if (options.stopSequences && options.stopSequences.length > 0) {
    commandOptions.inferenceConfig.stopSequences = options.stopSequences.slice(0, 4);
  }
  if (options.system?.trim()) {
    commandOptions.system = [{ text: options.system.trim() }];
  }
  if (options.toolConfig) {
    commandOptions.toolConfig = options.toolConfig;
  }

  const command = new ConverseCommand(commandOptions);

  try {
    const response = await client.send(command, { abortSignal: options.signal as any });
    const content = response.output?.message?.content;
    const stopReason = String(response.stopReason || "").toLowerCase();
    
    let text = "";
    if (content && Array.isArray(content)) {
      text = content.map((c: any) => c.text).filter(Boolean).join("\n");
    }

    return { text, stopReason, raw: response };
  } catch (err: any) {
    throw err;
  } finally {
    client.destroy();
  }
}

async function awsSdkConverseStream(
  input: string | { role: "user" | "assistant"; text?: string; content?: any[] }[],
  options: BedrockConverseOptions,
  callbacks: BedrockConverseStreamCallbacks = {}
): Promise<BedrockConverseResult> {
  const client = new BedrockRuntimeClient({
    region: options.region,
    credentials: fromNodeProviderChain(),
    maxAttempts: 1
  });

  const commandOptions: any = {
    modelId: options.modelId,
    messages: normalizeMessages(input),
    inferenceConfig: {
      maxTokens: options.maxTokens ?? 2048,
      temperature: options.temperature ?? 0.3
    }
  };

  if (typeof options.topP === "number") {
    commandOptions.inferenceConfig.topP = options.topP;
  }
  if (options.stopSequences && options.stopSequences.length > 0) {
    commandOptions.inferenceConfig.stopSequences = options.stopSequences.slice(0, 4);
  }
  if (options.system?.trim()) {
    commandOptions.system = [{ text: options.system.trim() }];
  }
  if (options.toolConfig) {
    commandOptions.toolConfig = options.toolConfig;
  }

  const command = new ConverseStreamCommand(commandOptions);

  try {
    const response = await client.send(command, { abortSignal: options.signal as any });
    let fullText = "";
    let stopReason = "";
    const blocks: any[] = [];
    const events: any[] = [];
    let callbackChain = Promise.resolve();

    if (response.stream) {
      for await (const chunk of response.stream) {
        let event: any = chunk;
        if (chunk.contentBlockStart) {
          event = { contentBlockStart: chunk.contentBlockStart };
        } else if (chunk.contentBlockDelta) {
          event = { contentBlockDelta: chunk.contentBlockDelta };
        } else if (chunk.messageStop) {
          event = { messageStop: chunk.messageStop };
        }
        
        events.push(event);
        if (event.messageStop?.stopReason) {
          stopReason = String(event.messageStop.stopReason).toLowerCase();
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
    }
    
    await callbackChain;

    const content = finalizeStreamContent(blocks);
    const text = fullText || content.map((c: any) => c.text).filter(Boolean).join("\n");
    const hasToolUse = content.some((c: any) => c.toolUse);
    
    if (!text.trim() && !hasToolUse) {
      throw new Error(`Bedrock stream completed without usable content (events=${events.length})`);
    }

    return {
      text,
      stopReason,
      raw: { output: { message: { content } }, stopReason, events }
    };
  } catch (err) {
    throw err;
  } finally {
    client.destroy();
  }
}

async function legacyHttpsConverse(
  input: string | { role: "user" | "assistant"; text?: string; content?: any[] }[],
  options: BedrockConverseOptions
): Promise<BedrockConverseResult> {
  const region = options.region;
  const modelId = options.modelId;
  const apiKey = options.apiKey;
  const payload = buildPayload(input, options);

  const requestOptions: https.RequestOptions = {
    method: "POST",
    hostname: `bedrock-runtime.${region}.amazonaws.com`,
    path: `/model/${encodeURIComponent(modelId)}/converse`,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
      "User-Agent": "safegraph-ai-vscode/0.18.3"
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
}

async function legacyHttpsConverseStream(
  input: string | { role: "user" | "assistant"; text?: string; content?: any[] }[],
  options: BedrockConverseOptions,
  callbacks: BedrockConverseStreamCallbacks = {}
): Promise<BedrockConverseResult> {
  const region = options.region;
  const modelId = options.modelId;
  const apiKey = options.apiKey;
  const payload = buildPayload(input, options);

  const requestOptions: https.RequestOptions = {
    method: "POST",
    hostname: `bedrock-runtime.${region}.amazonaws.com`,
    path: `/model/${encodeURIComponent(modelId)}/converse-stream`,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
      "User-Agent": "safegraph-ai-vscode/0.18.3"
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
}

export async function bedrockConverse(
  input: string | { role: "user" | "assistant"; text?: string; content?: any[] }[],
  options: BedrockConverseOptions
): Promise<BedrockConverseResult> {
  const maxRetries = options.retries ?? 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (options.apiKey && options.apiKey.trim().length > 0) {
        return await legacyHttpsConverse(input, options);
      } else {
        return await awsSdkConverse(input, options);
      }
    } catch (error) {
      lastError = error as Error;
      if (!shouldRetry(error) || attempt >= maxRetries) {
        break;
      }
      const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
      await sleep(delay);
    }
  }

  throw lastError || new Error("Bedrock request failed after retries");
}

export async function bedrockConverseStream(
  input: string | { role: "user" | "assistant"; text?: string; content?: any[] }[],
  options: BedrockConverseOptions,
  callbacks: BedrockConverseStreamCallbacks = {}
): Promise<BedrockConverseResult> {
  const maxRetries = options.retries ?? 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (options.apiKey && options.apiKey.trim().length > 0) {
        return await legacyHttpsConverseStream(input, options, callbacks);
      } else {
        return await awsSdkConverseStream(input, options, callbacks);
      }
    } catch (error) {
      lastError = error as Error;
      if (!shouldRetry(error) || attempt >= maxRetries) {
        break;
      }
      const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
      await sleep(delay);
    }
  }

  throw lastError || new Error("Bedrock stream request failed after retries");
}

export async function bedrockConverseText(userText: string, options: BedrockConverseOptions): Promise<string> {
  const r = await bedrockConverse(userText, options);
  return r.text;
}
