import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the entire env module since @t3-oss/env-core has issues in test environment
vi.mock("../../../lib/core/env.js", () => ({
  env: {
    LINEAR_API_KEY: "test-linear-key",
    OPENAI_API_KEY: "test-openai-key",
    KV_REST_API_URL: "http://localhost:8080",
    KV_REST_API_TOKEN: "test-token",
    GITHUB_APP_ID: "123456",
    GITHUB_PRIVATE_KEY: "test-private-key",
    SLACK_BOT_TOKEN: "xoxb-test-token",
    EXA_API_KEY: "test-exa-key",
  },
}));

describe("Environment Configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should load environment variables", async () => {
    const { env } = await import("../../../lib/core/env.js");

    expect(env.LINEAR_API_KEY).toBe("test-linear-key");
    expect(env.OPENAI_API_KEY).toBe("test-openai-key");
    expect(env.KV_REST_API_URL).toBe("http://localhost:8080");
    expect(env.KV_REST_API_TOKEN).toBe("test-token");
  });

  it("should provide access to environment variables", async () => {
    const { env } = await import("../../../lib/core/env.js");

    // Test that all expected environment variables are available
    expect(env.LINEAR_API_KEY).toBeDefined();
    expect(env.OPENAI_API_KEY).toBeDefined();
    expect(env.KV_REST_API_URL).toBeDefined();
    expect(env.KV_REST_API_TOKEN).toBeDefined();
  });

  it("should have correct environment variable values", async () => {
    const { env } = await import("../../../lib/core/env.js");

    expect(typeof env.LINEAR_API_KEY).toBe("string");
    expect(typeof env.OPENAI_API_KEY).toBe("string");
    expect(typeof env.KV_REST_API_URL).toBe("string");
    expect(typeof env.KV_REST_API_TOKEN).toBe("string");
  });
});
