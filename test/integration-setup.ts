import { Redis } from "@upstash/redis";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";

// Global integration test setup
beforeAll(async () => {
  // Set test environment
  vi.stubEnv("NODE_ENV", "test");

  // Use test database URLs - must be https for Upstash
  vi.stubEnv(
    "KV_REST_API_URL",
    process.env.TEST_REDIS_URL || "https://test-redis.upstash.io",
  );
  vi.stubEnv("KV_REST_API_TOKEN", process.env.TEST_REDIS_TOKEN || "test-token");

  // Mock all required environment variables for integration tests
  vi.stubEnv(
    "LINEAR_API_KEY",
    process.env.TEST_LINEAR_API_KEY || "test-linear-key",
  );
  vi.stubEnv("LINEAR_CLIENT_ID", "test-linear-client-id");
  vi.stubEnv("LINEAR_CLIENT_SECRET", "test-linear-client-secret");
  vi.stubEnv("GITHUB_APP_ID", process.env.TEST_GITHUB_APP_ID || "123456");
  vi.stubEnv(
    "GITHUB_PRIVATE_KEY",
    process.env.TEST_GITHUB_PRIVATE_KEY || "test-private-key",
  );
  vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "test-github-private-key");
  vi.stubEnv("GITHUB_APP_CLIENT_ID", "test-github-client-id");
  vi.stubEnv("GITHUB_APP_CLIENT_SECRET", "test-github-client-secret");
  vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "test-installation-id");
  vi.stubEnv(
    "SLACK_BOT_TOKEN",
    process.env.TEST_SLACK_BOT_TOKEN || "xoxb-test-token",
  );
  vi.stubEnv(
    "OPENAI_API_KEY",
    process.env.TEST_OPENAI_API_KEY || "test-openai-key",
  );
  vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
  vi.stubEnv("EXA_API_KEY", process.env.TEST_EXA_API_KEY || "test-exa-key");
  vi.stubEnv("WEBHOOK_SIGNING_SECRET", "test-webhook-secret");
  vi.stubEnv("REDIRECT_URI", "http://localhost:3000/callback");
  vi.stubEnv("WEBHOOK_URL", "http://localhost:3000/webhook");

  // Wait for services to be ready
  await new Promise((resolve) => setTimeout(resolve, 1000));
});

beforeEach(async () => {
  // Clean up test data before each integration test
  try {
    // Only try to clean up if we have a real Redis URL (not the test mock)
    const redisUrl = process.env.KV_REST_API_URL!;
    if (redisUrl !== "https://test-redis.upstash.io") {
      const redis = new Redis({
        url: redisUrl,
        token: process.env.KV_REST_API_TOKEN!,
      });

      // Clean up test keys (be careful with patterns)
      const testKeys = await redis.keys("test:*");
      if (testKeys.length > 0) {
        await redis.del(...testKeys);
      }
    }
  } catch (error) {
    console.warn("Failed to clean up test data:", error);
  }
});

afterEach(async () => {
  // Clean up after each test
  await new Promise((resolve) => setTimeout(resolve, 100));
});

afterAll(async () => {
  // Final cleanup
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
