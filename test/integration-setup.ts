import { Redis } from '@upstash/redis';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';

// Mock Redis for integration tests with proper value storage
const mockRedisStorage = new Map<string, any>();

vi.mock('@upstash/redis', () => ({
  Redis: vi.fn(() => ({
    set: vi.fn().mockImplementation((key: string, value: any) => {
      mockRedisStorage.set(key, value);
      return Promise.resolve('OK');
    }),
    get: vi.fn().mockImplementation((key: string) => {
      return Promise.resolve(mockRedisStorage.get(key) || null);
    }),
    del: vi.fn().mockImplementation((...keys: string[]) => {
      let deleted = 0;
      keys.forEach((key) => {
        if (mockRedisStorage.has(key)) {
          mockRedisStorage.delete(key);
          deleted++;
        }
      });
      return Promise.resolve(deleted);
    }),
    keys: vi.fn().mockResolvedValue([]),
    pipeline: vi.fn(() => ({
      set: vi.fn(),
      get: vi.fn(),
      exec: vi.fn().mockResolvedValue([['OK'], ['test-value']]),
    })),
  })),
}));

// Global integration test setup
beforeAll(async () => {
  // Set test environment
  vi.stubEnv('NODE_ENV', 'test');

  // Use localhost Redis URL for tests (will be mocked anyway)
  vi.stubEnv('KV_REST_API_URL', 'https://localhost:6379');
  vi.stubEnv('KV_REST_API_TOKEN', 'test-token');

  // Mock all required environment variables for integration tests
  vi.stubEnv(
    'LINEAR_API_KEY',
    process.env.TEST_LINEAR_API_KEY || 'test-linear-key'
  );
  vi.stubEnv('LINEAR_CLIENT_ID', 'test-linear-client-id');
  vi.stubEnv('LINEAR_CLIENT_SECRET', 'test-linear-client-secret');
  vi.stubEnv('GITHUB_APP_ID', process.env.TEST_GITHUB_APP_ID || '123456');
  vi.stubEnv(
    'GITHUB_PRIVATE_KEY',
    process.env.TEST_GITHUB_PRIVATE_KEY || 'test-private-key'
  );
  vi.stubEnv('GITHUB_APP_PRIVATE_KEY', 'test-github-private-key');
  vi.stubEnv('GITHUB_APP_CLIENT_ID', 'test-github-client-id');
  vi.stubEnv('GITHUB_APP_CLIENT_SECRET', 'test-github-client-secret');
  vi.stubEnv('GITHUB_APP_INSTALLATION_ID', 'test-installation-id');
  vi.stubEnv(
    'SLACK_BOT_TOKEN',
    process.env.TEST_SLACK_BOT_TOKEN || 'xoxb-test-token'
  );
  vi.stubEnv(
    'OPENAI_API_KEY',
    process.env.TEST_OPENAI_API_KEY || 'test-openai-key'
  );
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-anthropic-key');
  vi.stubEnv('EXA_API_KEY', process.env.TEST_EXA_API_KEY || 'test-exa-key');
  vi.stubEnv('WEBHOOK_SIGNING_SECRET', 'test-webhook-secret');
  vi.stubEnv('REDIRECT_URI', 'http://localhost:3000/callback');
  vi.stubEnv('WEBHOOK_URL', 'http://localhost:3000/webhook');
  vi.stubEnv('INTERNAL_API_TOKEN', 'test-internal-api-token');

  // Wait for services to be ready
  await new Promise((resolve) => setTimeout(resolve, 1000));
});

beforeEach(async () => {
  // Clean up mock Redis storage before each test
  mockRedisStorage.clear();
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
