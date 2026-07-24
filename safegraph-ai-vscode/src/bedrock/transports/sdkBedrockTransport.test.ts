import { SdkBedrockTransport } from "./sdkBedrockTransport";
import { BedrockRuntimeClient, ConverseCommand, ConverseStreamCommand } from "@aws-sdk/client-bedrock-runtime";

let mockSend: jest.Mock;

// Mock the AWS SDK client
jest.mock("@aws-sdk/client-bedrock-runtime", () => {
  const original = jest.requireActual("@aws-sdk/client-bedrock-runtime");
  return {
    ...original,
    BedrockRuntimeClient: jest.fn().mockImplementation(() => ({
      send: mockSend,
      destroy: jest.fn(),
    })),
  };
});

describe("SdkBedrockTransport", () => {
  let transport: SdkBedrockTransport;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend = jest.fn();
    transport = new SdkBedrockTransport({ region: "us-east-1" });
  });

  describe("converse", () => {
    it("sends ConverseCommand with correct modelId and parameters", async () => {
      mockSend.mockResolvedValueOnce({
        output: {
          message: {
            role: "assistant",
            content: [{ text: "Hello from Bedrock SDK" }],
          },
        },
        stopReason: "end_turn",
        metrics: { latencyMs: 120 },
      });

      const request = {
        modelId: "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
        region: "us-east-1",
        messages: [{ role: "user" as const, content: [{ text: "Hi" }] }],
        system: "You are a helpful assistant.",
        maxTokens: 1024,
        temperature: 0.7,
      };

      const response = await transport.converse(request);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const commandCall = mockSend.mock.calls[0][0];
      expect(commandCall).toBeInstanceOf(ConverseCommand);
      expect(commandCall.input.modelId).toBe("us.anthropic.claude-3-5-sonnet-20241022-v2:0");
      expect(commandCall.input.system).toEqual([{ text: "You are a helpful assistant." }]);
      expect(commandCall.input.inferenceConfig).toEqual({
        maxTokens: 1024,
        temperature: 0.7,
      });

      expect(response.text).toBe("Hello from Bedrock SDK");
      expect((response.raw as any).output.message.content).toEqual([{ text: "Hello from Bedrock SDK" }]);
      expect(response.stopReason).toBe("end_turn");
    });

    it("passes AbortSignal options to client.send", async () => {
      mockSend.mockResolvedValueOnce({
        output: { message: { role: "assistant", content: [] } },
        stopReason: "end_turn",
      });

      const controller = new AbortController();
      const request = {
        modelId: "anthropic.claude-v2",
        region: "us-east-1",
        messages: [{ role: "user" as const, content: [{ text: "Ping" }] }],
      };

      await transport.converse(request, controller.signal);

      expect(mockSend).toHaveBeenCalledWith(
        expect.any(ConverseCommand),
        { abortSignal: controller.signal }
      );
    });
  });

  describe("converseStream", () => {
    it("sends ConverseStreamCommand and yields stream events", async () => {
      async function* mockStream() {
        yield {
          contentBlockStart: {
            contentBlockIndex: 0,
            start: { toolUse: { toolUseId: "tool-1", name: "safegraph__view_file" } },
          },
        };
        yield {
          contentBlockDelta: {
            contentBlockIndex: 0,
            delta: { text: "Chunk 1" },
          },
        };
        yield {
          messageStop: { stopReason: "end_turn" },
        };
      }

      mockSend.mockResolvedValueOnce({
        stream: mockStream(),
      });

      const request = {
        modelId: "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
        region: "us-east-1",
        messages: [{ role: "user" as const, content: [{ text: "Run stream" }] }],
      };

      const events = [];
      for await (const event of transport.converseStream(request)) {
        events.push(event);
      }

      expect(mockSend).toHaveBeenCalledTimes(1);
      const commandCall = mockSend.mock.calls[0][0];
      expect(commandCall).toBeInstanceOf(ConverseStreamCommand);
      expect(commandCall.input.modelId).toBe("us.anthropic.claude-3-5-sonnet-20241022-v2:0");

      expect(events).toContainEqual(
        expect.objectContaining({
          type: "content_block_start",
          toolUseId: "tool-1",
          toolName: "safegraph__view_file",
        })
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "text_delta",
          text: "Chunk 1",
        })
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "stop",
          stopReason: "end_turn",
        })
      );
    });
  });
});
