import { resolveBedrockTransport } from "./authResolver";
import { BearerBedrockTransport } from "./transports/bearerBedrockTransport";
import { SdkBedrockTransport } from "./transports/sdkBedrockTransport";
import { validateBedrockConfiguration, BedrockConfigurationError } from "./bedrockClient";

describe("authResolver & config validation", () => {
  describe("resolveBedrockTransport", () => {
    it("selects SdkBedrockTransport when authMode is access-keys and both keys are present", () => {
      const transport = resolveBedrockTransport({
        authMode: "access-keys",
        credentials: { accessKeyId: "AKIAEXAMPLE", secretAccessKey: "secret" },
        region: "us-east-1",
      });
      expect(transport).toBeInstanceOf(SdkBedrockTransport);
    });

    it("throws BedrockConfigurationError when authMode is access-keys but the secret is missing", () => {
      expect(() =>
        resolveBedrockTransport({
          authMode: "access-keys",
          credentials: { accessKeyId: "AKIAEXAMPLE", secretAccessKey: " " },
          region: "us-east-1",
        })
      ).toThrow(BedrockConfigurationError);
    });

    it("auto mode prefers a bearer token over stored access keys", () => {
      const transport = resolveBedrockTransport({
        authMode: "auto",
        bearerToken: "token",
        credentials: { accessKeyId: "AKIAEXAMPLE", secretAccessKey: "secret" },
        region: "us-east-1",
      });
      expect(transport).toBeInstanceOf(BearerBedrockTransport);
    });

    it("auto mode uses stored access keys when no bearer token is present", () => {
      const transport = resolveBedrockTransport({
        authMode: "auto",
        credentials: { accessKeyId: "AKIAEXAMPLE", secretAccessKey: "secret" },
        region: "us-east-1",
      });
      expect(transport).toBeInstanceOf(SdkBedrockTransport);
    });

    it("selects BearerBedrockTransport when authMode is bearer-token and token is present", () => {
      const transport = resolveBedrockTransport({
        authMode: "bearer-token",
        bearerToken: "my-secret-token",
        region: "us-east-1",
      });
      expect(transport).toBeInstanceOf(BearerBedrockTransport);
    });

    it("throws BedrockConfigurationError when authMode is bearer-token but token is missing/empty", () => {
      expect(() =>
        resolveBedrockTransport({
          authMode: "bearer-token",
          bearerToken: "   ",
          region: "us-east-1",
        })
      ).toThrow(BedrockConfigurationError);
    });

    it("selects SdkBedrockTransport when authMode is aws-credentials", () => {
      const transport = resolveBedrockTransport({
        authMode: "aws-credentials",
        awsProfile: "dev-profile",
        region: "ap-southeast-1",
      });
      expect(transport).toBeInstanceOf(SdkBedrockTransport);
    });

    it("selects SdkBedrockTransport when authMode is aws-credentials even if bearerToken exists", () => {
      const transport = resolveBedrockTransport({
        authMode: "aws-credentials",
        bearerToken: "should-be-ignored-token",
        awsProfile: "dev-profile",
        region: "ap-southeast-1",
      });
      expect(transport).toBeInstanceOf(SdkBedrockTransport);
    });

    it("in auto mode, picks BearerBedrockTransport if token is present", () => {
      const transport = resolveBedrockTransport({
        authMode: "auto",
        bearerToken: "some-token",
        region: "us-west-2",
      });
      expect(transport).toBeInstanceOf(BearerBedrockTransport);
    });

    it("in auto mode, picks SdkBedrockTransport if token is missing", () => {
      const transport = resolveBedrockTransport({
        authMode: "auto",
        bearerToken: "",
        region: "us-west-2",
      });
      expect(transport).toBeInstanceOf(SdkBedrockTransport);
    });
  });

  describe("validateBedrockConfiguration", () => {
    it("throws when region is empty", () => {
      expect(() =>
        validateBedrockConfiguration({ region: "", modelId: "us.anthropic.claude-3-5-sonnet-20241022-v2:0" })
      ).toThrow("Amazon Bedrock region is not configured.");
    });

    it("throws when modelId is empty", () => {
      expect(() =>
        validateBedrockConfiguration({ region: "us-east-1", modelId: "" })
      ).toThrow("No Bedrock model is configured.");
    });

    it("passes when region and modelId are valid", () => {
      expect(() =>
        validateBedrockConfiguration({ region: "us-east-1", modelId: "anthropic.claude-v2" })
      ).not.toThrow();
    });
  });
});
