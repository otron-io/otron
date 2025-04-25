import { FastifyRequest, FastifyReply } from "fastify";
import createFastify from "fastify";
import crypto from "crypto";
import { config } from "../src/config.js";
import { LinearService } from "../src/linear.js";

const fastify = createFastify();

type WebhookPayload = {
  type: string;
  action: string;
  createdAt: string;
  organizationId: string;
  oauthClientId: string;
  appUserId: string;
  notification: {
    id: string;
    issueId?: string;
    commentId?: string;
    userId?: string;
  };
};

// Store tokens for each organization
const tokenStore: Record<string, string> = {};
const linearServices: Record<string, LinearService> = {};

// Initialize Linear service
const linearService = new LinearService(
  config.linearClientId!,
  config.linearClientSecret,
  config.redirectUri!,
);

// Verify webhook signature
function verifyWebhookSignature(request: FastifyRequest) {
  const signature = request.headers["linear-signature"] as string;
  if (!signature) {
    return false;
  }

  const hmac = crypto.createHmac("sha256", config.webhookSigningSecret!);
  hmac.update(JSON.stringify(request.body));
  const computedSignature = hmac.digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(computedSignature),
  );
}

// OAuth callback handler
fastify.get("/oauth/callback", async (request, reply) => {
  const { code, state } = request.query as { code: string; state: string };

  if (!code) {
    return reply.status(400).send({ error: "Missing code parameter" });
  }

  try {
    const accessToken = await linearService.getAccessToken(code);
    // In a real app, you'd store this token securely
    console.log("Access token:", accessToken);
    return reply.send({
      success: true,
      message: "Successfully authenticated!",
    });
  } catch (error) {
    console.error("OAuth error:", error);
    return reply.status(500).send({ error: "Authentication failed" });
  }
});

// Webhook handler
fastify.post("/webhook", async (request, reply) => {
  // Verify webhook signature
  if (!verifyWebhookSignature(request)) {
    return reply.status(401).send({ error: "Invalid signature" });
  }

  const payload = request.body as WebhookPayload;
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

  return reply.send({ success: true });
});

// Get auth URL
fastify.get("/auth", async (request, reply) => {
  const authUrl = linearService.getAuthUrl();
  return reply.send({ authUrl });
});

// Default route
fastify.get("/", async (request, reply) => {
  return reply.send({ message: "Fingertip Bot is running!" });
});

// Start the server if not running on Vercel
if (process.env.NODE_ENV !== "production") {
  const start = async () => {
    try {
      await fastify.listen({ port: 3000 });
      console.log("Server is running on http://localhost:3000");
    } catch (err) {
      console.error(err);
      process.exit(1);
    }
  };
  start();
}

// Export for Vercel
export default async function handler(req: any, res: any) {
  await fastify.ready();
  fastify.server.emit("request", req, res);
}
