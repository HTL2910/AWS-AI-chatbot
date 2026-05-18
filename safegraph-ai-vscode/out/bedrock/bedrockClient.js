"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.bedrockConverseText = bedrockConverseText;
const https = __importStar(require("https"));
async function bedrockConverseText(userText, options) {
    const region = options.region;
    const modelId = options.modelId;
    const apiKey = options.apiKey;
    const maxTokens = options.maxTokens ?? 1024;
    const temperature = options.temperature ?? 0.2;
    const payload = JSON.stringify({
        messages: [{ role: "user", content: [{ text: userText }] }],
        inferenceConfig: { maxTokens, temperature }
    });
    const requestOptions = {
        method: "POST",
        hostname: `bedrock-runtime.${region}.amazonaws.com`,
        path: `/model/${encodeURIComponent(modelId)}/converse`,
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload)
        }
    };
    const raw = await new Promise((resolve, reject) => {
        const req = https.request(requestOptions, (res) => {
            const chunks = [];
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
            if (options.signal.aborted)
                onAbort();
            else
                options.signal.addEventListener("abort", onAbort, { once: true });
        }
        req.write(payload);
        req.end();
    });
    const parsed = JSON.parse(raw);
    const content = parsed?.output?.message?.content;
    if (Array.isArray(content)) {
        const text = content.map((c) => c?.text).filter(Boolean).join("\n");
        if (text)
            return text;
    }
    return raw;
}
