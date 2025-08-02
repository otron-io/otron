import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Environment Configuration', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('should load environment variables', async () => {
    // Set test environment variables
    vi.stubEnv('LINEAR_API_KEY', 'test-linear-key');
    vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
    vi.stubEnv('KV_REST_API_URL', 'http://localhost:8080');
    vi.stubEnv('KV_REST_API_TOKEN', 'test-token');

    // Dynamically import env after setting environment variables
    const { env } = await import('../../../lib/core/env.js');

    expect(env.LINEAR_API_KEY).toBe('test-linear-key');
    expect(env.OPENAI_API_KEY).toBe('test-openai-key');
    expect(env.KV_REST_API_URL).toBe('http://localhost:8080');
    expect(env.KV_REST_API_TOKEN).toBe('test-token');
  });

  it('should throw error for missing required environment variables', async () => {
    // Clear required environment variables
    vi.stubEnv('LINEAR_API_KEY', '');
    vi.stubEnv('OPENAI_API_KEY', '');

    // Dynamic import should throw validation error
    await expect(async () => {
      await import('../../../lib/core/env.js');
    }).rejects.toThrow();
  });

  it('should handle optional environment variables', async () => {
    // Set only required variables
    vi.stubEnv('LINEAR_API_KEY', 'test-linear-key');
    vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
    vi.stubEnv('KV_REST_API_URL', 'http://localhost:8080');
    vi.stubEnv('KV_REST_API_TOKEN', 'test-token');

    const { env } = await import('../../../lib/core/env.js');

    expect(env.LINEAR_API_KEY).toBe('test-linear-key');
    expect(env.OPENAI_API_KEY).toBe('test-openai-key');
  });
});
