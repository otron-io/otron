import { Redis } from "@upstash/redis";
import { workerEnv } from "./env.js";

const redis = new Redis({
  url: workerEnv.REDIS_URL,
  token: workerEnv.REDIS_TOKEN,
});

/**
 * Get the Linear access token from Redis.
 * Same lookup logic as the Vercel side (lib/slack/slack-utils.ts).
 */
export async function getLinearAccessToken(): Promise<string | null> {
  // Try global token first
  const globalToken = (await redis.get("linearAccessToken")) as string | null;
  if (globalToken) return globalToken;

  // Fall back to any org-specific token
  const keys = await redis.keys("linear:*:accessToken");
  if (keys && keys.length > 0) {
    const orgToken = (await redis.get(keys[0])) as string | null;
    if (orgToken) return orgToken;
  }

  return null;
}
