import { VercelRequest, VercelResponse } from "@vercel/node";
import { env } from "../src/env.js";
import { LinearService } from "../src/linear.js";
import { Redis } from "@upstash/redis";

// Initialize Linear service
const linearService = new LinearService(
  env.LINEAR_CLIENT_ID,
  env.LINEAR_CLIENT_SECRET,
  env.REDIRECT_URI,
);

// Initialize Upstash Redis
const redis = new Redis({
  url: env.KV_REST_API_URL,
  token: env.KV_REST_API_TOKEN,
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only handle GET requests
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const code = req.query.code as string;
  if (!code) {
    return res.status(400).json({ error: "Missing code parameter" });
  }

  try {
    const { accessToken, appUserId, organizationId } =
      await linearService.getAccessToken(code);

    // Store tokens in both formats - organization-specific and global
    // Organization-specific keys
    if (organizationId) {
      await redis.set(`linear:${organizationId}:accessToken`, accessToken);
      await redis.set(`linear:${organizationId}:appUserId`, appUserId);
    }

    // Keep storing global keys for backward compatibility
    await redis.set("linearAccessToken", accessToken);
    await redis.set("linearAppUserId", appUserId);

    console.log("Access token:", accessToken);
    console.log("App user ID:", appUserId);
    console.log("Organization ID:", organizationId);

    return res.status(200).json({
      success: true,
      message: "Successfully authenticated!",
    });
  } catch (error) {
    console.error("OAuth error:", error);
    return res.status(500).json({ error: "Authentication failed" });
  }
}
