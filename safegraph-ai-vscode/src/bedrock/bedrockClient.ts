import * as https from "https";

export type BedrockConverseOptions = {
  region: string;
  modelId: string;
  apiKey: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  retries?: number;
  toolConfig?: any;
};

export type BedrockConverseResult = {
  text: string;
  stopReason: string;
  raw: any;
};

export function isExpiredBearerTokenError(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error);
  return /Bedrock\s+403/i.test(message) && /Bearer Token has expired/i.test(message);
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function bedrockConverse(
  input: string | { role: "user" | "assistant"; text?: string; content?: any[] }[],
  options: BedrockConverseOptions
): Promise<BedrockConverseResult> {
  const region = options.region;
  const modelId = options.modelId;
  const apiKey = options.apiKey;
  const maxTokens = options.maxTokens ?? 2048;
  const temperature = options.temperature ?? 0.3;
  const maxRetries = options.retries ?? 2;

  const messages = typeof input === "string" 
    ? [{ role: "user", content: [{ text: input }] }]
    : input.map(m => ({ 
        role: m.role, 
        content: m.content ? m.content : [{ text: m.text || "" }] 
      }));

  const payloadObj: any = {
    messages,
    inferenceConfig: { maxTokens, temperature }
  };
  if (options.toolConfig) {
    payloadObj.toolConfig = options.toolConfig;
  }
  const payload = JSON.stringify(payloadObj);

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
          "User-Agent": "safegraph-ai-vscode/1.0"
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

export async function bedrockConverseText(userText: string, options: BedrockConverseOptions): Promise<string> {
  const r = await bedrockConverse(userText, options);
  return r.text;
}
