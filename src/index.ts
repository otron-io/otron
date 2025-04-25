import fastify from "fastify";
import crypto from "crypto";
import { config } from "./config";
import { LinearService } from "./linear";

const server = fastify();
const port = process.env.PORT || 3000;

// Initialize Linear service
const linearService = new LinearService(
  config.linearClientId,
  config.linearClientSecret,
  config.redirectUri,
);

// Verify webhook signature
function verifyWebhookSignature(request: any, body: string) {
  const signature = request.headers["linear-signature"] as string;
  if (!signature) {
    return false;
  }

  const hmac = crypto.createHmac("sha256", config.webhookSigningSecret);
  hmac.update(body);
  const computedSignature = hmac.digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(computedSignature),
  );
}

// OAuth callback handler
server.get("/oauth/callback", async (request, reply) => {
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
server.post("/webhook", async (request, reply) => {
  const rawBody = JSON.stringify(request.body);

  // Verify webhook signature
  if (!verifyWebhookSignature(request, rawBody)) {
    return reply.status(401).send({ error: "Invalid signature" });
  }

  const payload = request.body as any;
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
server.get("/auth", async (request, reply) => {
  const authUrl = linearService.getAuthUrl();
  return reply.send({ authUrl });
});

// Default route
server.get("/", async (request, reply) => {
  return reply.send({ message: "Fingertip Bot is running!" });
});

// Start the server when running directly (not in Vercel)
const start = async () => {
  try {
    await server.listen({ port: port as number, host: "0.0.0.0" });
    console.log(`Server is running on http://localhost:${port}`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

if (require.main === module) {
  start();
}

export default server;
