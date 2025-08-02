import { beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { mswHandlers } from './mocks/msw-handlers';

// Setup MSW (Mock Service Worker) for API mocking
const server = setupServer(...mswHandlers);

// Global test setup
beforeAll(() => {
  // Start MSW server
  server.listen({
    onUnhandledRequest: 'warn',
  });

  // Mock environment variables for tests
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('KV_REST_API_URL', 'http://localhost:8080');
  vi.stubEnv('KV_REST_API_TOKEN', 'test-token');
  vi.stubEnv('LINEAR_API_KEY', 'test-linear-key');
  vi.stubEnv('GITHUB_APP_ID', '123456');
  vi.stubEnv('GITHUB_PRIVATE_KEY', 'test-private-key');
  vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test-token');
  vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
  vi.stubEnv('EXA_API_KEY', 'test-exa-key');

  // Mock console methods to reduce noise in tests
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

beforeEach(() => {
  // Reset all mocks before each test
  vi.clearAllMocks();
});

afterEach(() => {
  // Reset MSW handlers after each test
  server.resetHandlers();
});

afterAll(() => {
  // Close MSW server
  server.close();

  // Restore all mocks
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
