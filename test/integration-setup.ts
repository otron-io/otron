import { beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { Redis } from '@upstash/redis';

// Global integration test setup
beforeAll(async () => {
  // Set test environment
  vi.stubEnv('NODE_ENV', 'test');

  // Use test database URLs
  vi.stubEnv(
    'KV_REST_API_URL',
    process.env.TEST_REDIS_URL || 'redis://localhost:6379'
  );
  vi.stubEnv('KV_REST_API_TOKEN', process.env.TEST_REDIS_TOKEN || 'test-token');

  // Mock external API keys for integration tests
  vi.stubEnv(
    'LINEAR_API_KEY',
    process.env.TEST_LINEAR_API_KEY || 'test-linear-key'
  );
  vi.stubEnv('GITHUB_APP_ID', process.env.TEST_GITHUB_APP_ID || '123456');
  vi.stubEnv(
    'GITHUB_PRIVATE_KEY',
    process.env.TEST_GITHUB_PRIVATE_KEY || 'test-private-key'
  );
  vi.stubEnv(
    'SLACK_BOT_TOKEN',
    process.env.TEST_SLACK_BOT_TOKEN || 'xoxb-test-token'
  );
  vi.stubEnv(
    'OPENAI_API_KEY',
    process.env.TEST_OPENAI_API_KEY || 'test-openai-key'
  );
  vi.stubEnv('EXA_API_KEY', process.env.TEST_EXA_API_KEY || 'test-exa-key');

  // Wait for services to be ready
  await new Promise((resolve) => setTimeout(resolve, 1000));
});

beforeEach(async () => {
  // Clean up test data before each integration test
  try {
    const redis = new Redis({
      url: process.env.KV_REST_API_URL!,
      token: process.env.KV_REST_API_TOKEN!,
    });

    // Clean up test keys (be careful with patterns)
    const testKeys = await redis.keys('test:*');
    if (testKeys.length > 0) {
      await redis.del(...testKeys);
    }
  } catch (error) {
    console.warn('Failed to clean up test data:', error);
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
