import axios, { isAxiosError } from "axios";
import type { Readable } from "stream";
import { ProviderRequestError } from "./errors";
import {
  applyChatChunk,
  chatCompletionsUrl,
  completionToResult,
  consumeSseBuffer,
  createStreamState,
  formatHttpError,
  isLocalBaseUrl,
  modelsUrl,
  readErrorMessage,
  readModelIds,
  shouldRetryStatus,
  streamStateToResult,
  toOpenAIMessages,
  toOpenAITools,
  wantsMaxCompletionTokens
} from "./openaiChat";
import type { LanguageModelProvider, ProviderConverseResult, ProviderInput, ProviderRequestOptions, ProviderStreamCallbacks } from "./types";

export type OpenAICompatibleConfig = {
  baseUrl: string;
  apiKey: string;
};

const REQUEST_TIMEOUT_MS = 120_000;

export function createOpenAICompatibleProvider(config: OpenAICompatibleConfig): LanguageModelProvider {
  return {
    id: "openai-compatible",
    converse(input, options) {
      return postChat(config, input, options, false);
    },
    converseStream(input, options, callbacks) {
      return postChat(config, input, options, true, callbacks);
    }
  };
}

export async function probeOpenAIModels(baseUrl: string, apiKey?: string, signal?: AbortSignal): Promise<string[]> {
  const headers = requestHeaders(apiKey || "");
  const response = await axios.get<unknown>(modelsUrl(baseUrl), {
    headers,
    timeout: 2500,
    signal,
    validateStatus: () => true
  });
  if (response.status < 200 || response.status >= 300) {
    throw new ProviderRequestError(formatHttpError(response.status, response.data, baseUrl, ""));
  }
  return readModelIds(response.data);
}

async function postChat(
  config: OpenAICompatibleConfig,
  input: ProviderInput,
  options: ProviderRequestOptions,
  stream: boolean,
  callbacks?: ProviderStreamCallbacks
): Promise<ProviderConverseResult> {
  const retries = options.retries ?? (stream ? 0 : 2);
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await postOnce(config, input, options, stream, callbacks, "max_tokens");
    } catch (error) {
      lastError = error;
      if (options.signal?.aborted || isAbortError(error)) throw new Error("aborted");
      const retryable = error instanceof RetryableRequest;
      if (!retryable || attempt === retries) {
        if (error instanceof RetryableRequest) throw new ProviderRequestError(error.message);
        throw error;
      }
      await delay(400 * (attempt + 1), options.signal);
    }
  }
  throw lastError instanceof Error ? lastError : new ProviderRequestError("The model request failed.");
}

async function postOnce(
  config: OpenAICompatibleConfig,
  input: ProviderInput,
  options: ProviderRequestOptions,
  stream: boolean,
  callbacks: ProviderStreamCallbacks | undefined,
  tokenField: "max_tokens" | "max_completion_tokens"
): Promise<ProviderConverseResult> {
  const url = chatCompletionsUrl(config.baseUrl);
  const body = buildBody(input, options, stream, tokenField);
  try {
    const response = await axios.post<unknown>(url, body, {
      headers: requestHeaders(config.apiKey),
      timeout: REQUEST_TIMEOUT_MS,
      signal: options.signal,
      responseType: stream ? "stream" : "json",
      validateStatus: () => true
    });

    if (response.status < 200 || response.status >= 300) {
      const payload = stream ? await readStreamText(response.data) : response.data;
      const parsed = parseMaybeJson(payload);
      if (tokenField === "max_tokens" && wantsMaxCompletionTokens(parsed)) {
        return postOnce(config, input, options, stream, callbacks, "max_completion_tokens");
      }
      const message = formatHttpError(response.status, parsed, config.baseUrl, options.modelId);
      if (shouldRetryStatus(response.status)) throw new RetryableRequest(message);
      throw new ProviderRequestError(message);
    }

    if (!stream) return completionToResult(response.data);
    return readSse(response.data, callbacks, options.signal);
  } catch (error) {
    if (error instanceof ProviderRequestError || error instanceof RetryableRequest) throw error;
    if (options.signal?.aborted || isAbortError(error)) throw new Error("aborted");
    if (isAxiosError(error)) {
      if (error.code === "ECONNABORTED") {
        throw new ProviderRequestError(`The request to ${config.baseUrl} timed out.`);
      }
      if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND" || error.code === "ECONNRESET") {
        const localHint = isLocalBaseUrl(config.baseUrl)
          ? " If this is 9Router, start it and confirm it is listening on http://localhost:20128."
          : "";
        const wrapped = new ProviderRequestError(`Cannot reach ${config.baseUrl}.${localHint}`);
        if (error.code === "ECONNRESET") throw new RetryableRequest(wrapped.message);
        throw wrapped;
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new ProviderRequestError(message || `Request to ${config.baseUrl} failed.`);
  }
}

function buildBody(
  input: ProviderInput,
  options: ProviderRequestOptions,
  stream: boolean,
  tokenField: "max_tokens" | "max_completion_tokens"
): Record<string, unknown> {
  const tools = toOpenAITools(options.toolConfig);
  const body: Record<string, unknown> = {
    model: options.modelId,
    messages: toOpenAIMessages(input, options.system),
    temperature: options.temperature,
    stream
  };
  if (typeof options.maxTokens === "number") body[tokenField] = options.maxTokens;
  if (typeof options.topP === "number") body.top_p = options.topP;
  if (options.stopSequences && options.stopSequences.length > 0) body.stop = options.stopSequences;
  if (tools) body.tools = tools;
  if (stream) body.stream_options = { include_usage: true };
  return body;
}

function requestHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "Safegraph-AI",
    "HTTP-Referer": "https://github.com/HTL2910/AWS-AI-chatbot",
    "X-Title": "Safegraph AI"
  };
  const key = apiKey.trim();
  if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}

async function readSse(
  data: unknown,
  callbacks: ProviderStreamCallbacks | undefined,
  signal?: AbortSignal
): Promise<ProviderConverseResult> {
  const stream = asReadable(data);
  if (!stream) throw new ProviderRequestError("The endpoint returned an empty stream.");
  const state = createStreamState();
  let buffer = "";
  let callbackChain = Promise.resolve();
  const onAbort = () => stream.destroy(new Error("aborted"));
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    for await (const chunk of stream) {
      const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      buffer += text;
      const parsed = consumeSseBuffer(buffer);
      buffer = parsed.rest;
      for (const event of parsed.events) {
        if (event === "[DONE]") continue;
        let payload: unknown;
        try {
          payload = JSON.parse(event);
        } catch {
          continue;
        }
        const { textDelta } = applyChatChunk(state, payload);
        if (textDelta && callbacks?.onText) {
          const delta = textDelta;
          const snapshot = state.text;
          callbackChain = callbackChain.then(() => callbacks.onText!(delta, snapshot)).then(() => undefined);
        }
      }
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
  await callbackChain;
  const trailing = buffer.trim();
  if (trailing.startsWith("data:")) {
    const data = trailing.slice(5).trim();
    if (data && data !== "[DONE]") {
      try {
        applyChatChunk(state, JSON.parse(data));
      } catch {
        // ignore a partial trailing frame
      }
    }
  }
  if (!state.text && state.tools.size === 0) {
    const detail = readErrorMessage(parseMaybeJson(buffer));
    if (detail) throw new ProviderRequestError(detail);
  }
  return streamStateToResult(state);
}

function asReadable(data: unknown): Readable | undefined {
  if (!data || typeof data !== "object") return undefined;
  if (Symbol.asyncIterator in data) return data as Readable;
  return undefined;
}

async function readStreamText(data: unknown): Promise<unknown> {
  const stream = asReadable(data);
  if (!stream) return data;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseMaybeJson(payload: unknown): unknown {
  if (typeof payload !== "string") return payload;
  const trimmed = payload.trim();
  if (!trimmed) return payload;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return payload;
  }
}

function isAbortError(error: unknown): boolean {
  if (isAxiosError(error) && error.code === "ERR_CANCELED") return true;
  return error instanceof Error && /aborted|canceled/i.test(error.message);
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

class RetryableRequest extends Error {
  readonly name = "RetryableRequest";

  constructor(message: string) {
    super(message);
  }
}
