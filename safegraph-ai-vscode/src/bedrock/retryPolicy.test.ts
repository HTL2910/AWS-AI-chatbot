import {
  isRetryableBedrockError,
  calculateRetryDelay,
  sleep,
  withBedrockRetry,
} from "./retryPolicy";

describe("retryPolicy", () => {
  describe("isRetryableBedrockError", () => {
    it("returns true for HTTP 429", () => {
      expect(isRetryableBedrockError({ statusCode: 429 })).toBe(true);
      expect(isRetryableBedrockError(new Error("Bedrock 429"))).toBe(true);
    });

    it("returns true for HTTP 500 and 503", () => {
      expect(isRetryableBedrockError({ statusCode: 500 })).toBe(true);
      expect(isRetryableBedrockError({ statusCode: 503 })).toBe(true);
      expect(isRetryableBedrockError(new Error("HTTP 502"))).toBe(true);
    });

    it("returns false for ValidationException and AccessDeniedException", () => {
      expect(isRetryableBedrockError({ name: "ValidationException" })).toBe(false);
      expect(isRetryableBedrockError({ name: "AccessDeniedException" })).toBe(false);
    });

    it("returns false for HTTP 404 and 400", () => {
      expect(isRetryableBedrockError({ statusCode: 404 })).toBe(false);
      expect(isRetryableBedrockError({ statusCode: 400 })).toBe(false);
    });

    it("returns false for AbortError and user cancellation", () => {
      expect(isRetryableBedrockError({ name: "AbortError" })).toBe(false);
      expect(isRetryableBedrockError(new Error("request aborted by user"))).toBe(false);
    });

    it("returns true for ECONNRESET and ETIMEDOUT transient network errors", () => {
      expect(isRetryableBedrockError({ code: "ECONNRESET" })).toBe(true);
      expect(isRetryableBedrockError(new Error("read ETIMEDOUT"))).toBe(true);
    });

    it("returns false for unknown programming errors (e.g. TypeError)", () => {
      expect(isRetryableBedrockError(new TypeError("Cannot read property 'x' of undefined"))).toBe(false);
    });
  });

  describe("calculateRetryDelay", () => {
    it("calculates delay within jitter ceiling", () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const delay = calculateRetryDelay(attempt, 500, 8000);
        const ceiling = Math.min(8000, 500 * 2 ** attempt);
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThan(ceiling);
      }
    });
  });

  describe("withBedrockRetry", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("returns result on first attempt if successful", async () => {
      const op = jest.fn().mockResolvedValue("success");
      const result = await withBedrockRetry(op, { maxRetries: 2 });
      expect(result).toBe("success");
      expect(op).toHaveBeenCalledTimes(1);
    });

    it("retries on retryable error and succeeds", async () => {
      const op = jest
        .fn()
        .mockRejectedValueOnce({ statusCode: 429 })
        .mockResolvedValueOnce("recovered");

      const promise = withBedrockRetry(op, { maxRetries: 2 });
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe("recovered");
      expect(op).toHaveBeenCalledTimes(2);
    });

    it("throws immediately without retry on non-retryable error", async () => {
      const nonRetryable = { name: "ValidationException" };
      const op = jest.fn().mockRejectedValue(nonRetryable);

      await expect(withBedrockRetry(op, { maxRetries: 2 })).rejects.toEqual(nonRetryable);
      expect(op).toHaveBeenCalledTimes(1);
    });
  });
});
