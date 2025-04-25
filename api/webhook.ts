import { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";
import { env } from "../src/env.js";
import { LinearService } from "../src/linear.js";
import { Redis } from "@upstash/redis";

// Initialize Upstash Redis
const redis = new Redis({
  url: "https://prompt-frog-28720.upstash.io",
  token: "AXAwAAIjcDFhYTVlYTk4MGI2N2U0NTQ3ODg1NzkzMjU3MmFiMWU1YnAxMA",
});

// Verify webhook signature
function verifyWebhookSignature(request: any, body: string) {
  const signature = request.headers["linear-signature"] as string;
  if (!signature) {
    return false;
  }
  const hmac = crypto.createHmac("sha256", env.WEBHOOK_SIGNING_SECRET);
  hmac.update(body);
  const computedSignature = hmac.digest("hex");
  return signature === computedSignature;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only handle POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const rawBody = JSON.stringify(req.body);

  // Verify webhook signature
  if (!verifyWebhookSignature(req, rawBody)) {
    console.error("Invalid webhook signature");
    return res.status(401).json({ error: "Invalid signature" });
  }

  // Get stored tokens from Upstash Redis
  const accessToken = (await redis.get("linearAccessToken")) as string;
  const appUserId = (await redis.get("linearAppUserId")) as string;

  if (!accessToken) {
    console.error("No access token found in Redis");
    return res.status(500).json({ error: "Authentication missing" });
  }

  // Initialize Linear service with stored credentials
  const linearService = new LinearService(
    env.LINEAR_CLIENT_ID,
    env.LINEAR_CLIENT_SECRET,
    env.REDIRECT_URI,
  );
  linearService.setStoredCredentials(accessToken, appUserId);

  const payload = req.body as any;
  console.log("Received webhook:", JSON.stringify(payload, null, 2));

  try {
    // Process the webhook based on action type
    if (payload.type === "AppUserNotification") {
      switch (payload.action) {
        case "issueMention":
          console.log("Processing issue mention");
          if (payload.notification && payload.notification.issueId) {
            await linearService.respondToMention(payload.notification.issueId);
            console.log("Successfully responded to mention");
          }
          break;

        case "issueCommentMention":
          console.log("Processing comment mention");
          if (payload.notification && payload.notification.commentId) {
            await linearService.respondToComment(
              payload.notification.commentId,
            );
            console.log("Successfully responded to comment mention");
          }
          break;

        case "issueEmojiReaction":
        case "issueCommentReaction":
          console.log("Processing reaction");
          if (payload.notification && payload.notification.commentId) {
            await linearService.addReaction(payload.notification.commentId);
            console.log("Successfully added reaction");
          }
          break;

        default:
          console.log(`Unhandled action: ${payload.action}`);
      }
    }
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Error processing webhook:", error);
    return res.status(500).json({ error: "Failed to process webhook" });
  }
}
