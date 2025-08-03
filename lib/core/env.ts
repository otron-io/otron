import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

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

    // GitHub App authentication (required)
    GITHUB_APP_ID: z.string().min(1),
    GITHUB_APP_PRIVATE_KEY: z.string().min(1),
    GITHUB_APP_CLIENT_ID: z.string().min(1),
    GITHUB_APP_CLIENT_SECRET: z.string().min(1),
    GITHUB_APP_INSTALLATION_ID: z.string().min(1),

    REPO_BASE_BRANCH: z.string().min(1).default("main"),
    ALLOWED_REPOSITORIES: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().min(1),

    // Authentication
    ADMIN_PASSWORD: z.string().min(1).default("admin"),
    INTERNAL_API_TOKEN: z.string().min(1).default("internal-token"),

    // CORS and Frontend
    FRONTEND_URL: z.string().url().optional(),

    // Runtime environment
    VERCEL_URL: z.string().optional().default("http://localhost:3000"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
