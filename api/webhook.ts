import { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";
import { env } from "../src/env.js";
import { LinearService } from "../src/linear.js";

// Initialize Linear service
const linearService = new LinearService(
  env.LINEAR_CLIENT_ID,
  env.LINEAR_CLIENT_SECRET,
  env.REDIRECT_URI,
);

// Verify webhook signature
function verifyWebhookSignature(request: any, body: string) {
  const signature = request.headers["linear-signature"] as string;
  if (!signature) {
    return false;
  }
  const hmac = crypto.createHmac("sha256", env.WEBHOOK_SIGNING_SECRET);
  hmac.update(body);
  const computedSignature = hmac.digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(computedSignature),
    );
  } catch (e) {
    return false;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only handle POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const rawBody = JSON.stringify(req.body);

  // Verify webhook signature
  if (!verifyWebhookSignature(req, rawBody)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  const payload = req.body as any;
  console.log("Received webhook:", payload);

  // Process the webhook based on action type
  if (payload.type === "AppUserNotification") {
    switch (payload.action) {
      case "issueMention":
        if (payload.notification.issueId) {
          await linearService.respondToMention(payload.notification.issueId);
        }
        break;
      case "issueCommentMention":
        if (payload.notification.commentId) {
          await linearService.respondToComment(payload.notification.commentId);
        }
        break;
      case "issueEmojiReaction":
      case "issueCommentReaction":
        if (payload.notification.commentId) {
          await linearService.addReaction(payload.notification.commentId);
        }
        break;
      default:
        console.log(`Unhandled action: ${payload.action}`);
    }
  }

  return res.status(200).json({ success: true });
}
