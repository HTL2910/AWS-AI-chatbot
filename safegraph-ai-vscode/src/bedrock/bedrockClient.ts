import * as https from "https";

export type BedrockConverseOptions = {
  region: string;
  modelId: string;
  apiKey: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
};

export async function bedrockConverseText(
  userText: string,
  options: BedrockConverseOptions
): Promise<string> {
  const region = options.region;
  const modelId = options.modelId;
  const apiKey = options.apiKey;
  const maxTokens = options.maxTokens ?? 1024;
  const temperature = options.temperature ?? 0.2;

  const payload = JSON.stringify({
    messages: [{ role: "user", content: [{ text: userText }] }],
    inferenceConfig: { maxTokens, temperature }
  });

  const requestOptions: https.RequestOptions = {
    method: "POST",
    hostname: `bedrock-runtime.${region}.amazonaws.com`,
    path: `/model/${encodeURIComponent(modelId)}/converse`,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload)
    }
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
        reject(new Error(`Bedrock ${res.statusCode ?? "ERR"}: ${body}`));
      });
    });
    req.on("error", reject);
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
  if (Array.isArray(content)) {
    const text = content.map((c: any) => c?.text).filter(Boolean).join("\n");
    if (text) return text;
  }
  return raw;
}
