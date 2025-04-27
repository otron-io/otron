import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const env = createEnv({
  server: {
    LINEAR_CLIENT_ID: z.string().min(1),
    LINEAR_CLIENT_SECRET: z.string().min(1),
    WEBHOOK_SIGNING_SECRET: z.string().min(1),
    REDIRECT_URI: z.string().url(),
    WEBHOOK_URL: z.string().url(),
    OPENAI_API_KEY: z.string().min(1),
    KV_REST_API_URL: z.string().url(),
    KV_REST_API_TOKEN: z.string().min(1),

    // New environment variables for the autonomous developer agent
    GITHUB_TOKEN: z.string().min(1),
    REPO_BASE_BRANCH: z.string().min(1).default('main'),
    CLAUDE_API_KEY: z.string().min(1).optional(),
    ALLOWED_REPOSITORIES: z.string().optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
