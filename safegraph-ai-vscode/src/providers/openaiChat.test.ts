import {
  applyChatChunk,
  chatCompletionsUrl,
  completionToResult,
  consumeSseBuffer,
  createStreamState,
  formatHttpError,
  isLocalBaseUrl,
  mapFinishReason,
  modelsUrl,
  streamStateToResult,
  toOpenAIMessages,
  toOpenAITools,
  wantsMaxCompletionTokens
} from "./openaiChat";

describe("openai chat adapter", () => {
  it("joins a /v1 base URL to chat completions once", () => {
    expect(chatCompletionsUrl("http://localhost:20128/v1")).toBe("http://localhost:20128/v1/chat/completions");
    expect(chatCompletionsUrl("http://localhost:20128/v1/")).toBe("http://localhost:20128/v1/chat/completions");
    expect(chatCompletionsUrl("https://api.openai.com/v1/chat/completions")).toBe(
      "https://api.openai.com/v1/chat/completions"
    );
    expect(modelsUrl("http://localhost:20128/v1/")).toBe("http://localhost:20128/v1/models");
  });

  it("treats localhost gateways as local", () => {
    expect(isLocalBaseUrl("http://localhost:20128/v1")).toBe(true);
    expect(isLocalBaseUrl("http://127.0.0.1:4000/v1")).toBe(true);
    expect(isLocalBaseUrl("https://openrouter.ai/api/v1")).toBe(false);
  });

  it("maps text turns and a system prompt", () => {
    const messages = toOpenAIMessages("Say OK", "You are Safegraph.");
    expect(messages).toEqual([
      { role: "system", content: "You are Safegraph." },
      { role: "user", content: "Say OK" }
    ]);
  });

  it("maps assistant tool calls and tool results", () => {
    const messages = toOpenAIMessages([
      { role: "user", text: "Read src/a.ts" },
      {
        role: "assistant",
        content: [
          {
            toolUse: {
              toolUseId: "call_1",
              name: "safegraph__read_file",
              input: { path: "src/a.ts" }
            }
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            toolResult: {
              toolUseId: "call_1",
              content: [{ text: "export const a = 1;" }],
              status: "success"
            }
          }
        ]
      }
    ]);
    expect(messages[1]).toMatchObject({
      role: "assistant",
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "safegraph__read_file", arguments: JSON.stringify({ path: "src/a.ts" }) }
        }
      ]
    });
    expect(messages[2]).toEqual({
      role: "tool",
      tool_call_id: "call_1",
      content: "export const a = 1;"
    });
  });

  it("maps Bedrock tool specs to OpenAI functions", () => {
    const tools = toOpenAITools({
      tools: [
        {
          toolSpec: {
            name: "safegraph__read_file",
            description: "Read a file",
            inputSchema: { json: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }
          }
        }
      ]
    });
    expect(tools?.[0].function.name).toBe("safegraph__read_file");
    expect(tools?.[0].function.parameters).toMatchObject({ type: "object" });
  });

  it("maps finish reasons back to the agent loop vocabulary", () => {
    expect(mapFinishReason("tool_calls", false)).toBe("tool_use");
    expect(mapFinishReason("stop", true)).toBe("tool_use");
    expect(mapFinishReason("length", false)).toBe("max_tokens");
    expect(mapFinishReason("stop", false)).toBe("end_turn");
  });

  it("rebuilds a tool-use result from a non-stream completion", () => {
    const result = completionToResult({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [
              { id: "call_9", function: { name: "safegraph__list_files", arguments: "{\"glob\":\"*.ts\"}" } }
            ]
          }
        }
      ],
      usage: { prompt_tokens: 12, completion_tokens: 4 }
    });
    expect(result.stopReason).toBe("tool_use");
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 4 });
    expect(result.raw.output.message.content).toEqual([
      {
        toolUse: {
          toolUseId: "call_9",
          name: "safegraph__list_files",
          input: { glob: "*.ts" }
        }
      }
    ]);
  });

  it("assembles streamed text and tool-call fragments", () => {
    const state = createStreamState();
    const first = applyChatChunk(state, {
      choices: [{ delta: { content: "Hello" } }]
    });
    applyChatChunk(state, {
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, id: "call_2", function: { name: "safegraph__read_file", arguments: "{\"pa" } }]
          }
        }
      ]
    });
    applyChatChunk(state, {
      choices: [{ finish_reason: "tool_calls", delta: { tool_calls: [{ index: 0, function: { arguments: "th\":\"a.ts\"}" } }] } }]
    });
    const result = streamStateToResult(state);
    expect(first.textDelta).toBe("Hello");
    expect(result.text).toBe("Hello");
    expect(result.stopReason).toBe("tool_use");
    const tool = result.raw.output.message.content.find((block) => "toolUse" in block);
    expect(tool && "toolUse" in tool ? tool.toolUse.input : undefined).toEqual({ path: "a.ts" });
  });

  it("splits SSE frames and ignores the DONE sentinel", () => {
    const parsed = consumeSseBuffer('data: {"ok":1}\n\ndata: [DONE]\n\ndata: {"partial"');
    expect(parsed.events).toEqual(['{"ok":1}', "[DONE]"]);
    expect(parsed.rest).toContain("partial");
  });

  it("writes user-facing HTTP errors and detects max_tokens rejection", () => {
    expect(formatHttpError(401, { error: { message: "bad key" } }, "https://api.openai.com/v1", "gpt-4.1")).toContain(
      "rejected"
    );
    expect(formatHttpError(404, { error: { message: "no such model" } }, "http://localhost:20128/v1", "missing")).toContain(
      "missing"
    );
    expect(wantsMaxCompletionTokens({ error: { message: "Unsupported parameter: 'max_tokens'" } })).toBe(true);
    expect(wantsMaxCompletionTokens({ error: { message: "model not found" } })).toBe(false);
  });
});
