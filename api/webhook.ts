import { LinearClient } from "@linear/sdk";
import { VercelRequest, VercelResponse } from "@vercel/node";
import { Redis } from "@upstash/redis";
import crypto from "crypto";
import {
  analyzeIssue,
  getIssueContext,
  answerUserQuestion,
} from "../src/ai.js";
import { env } from "../src/env.js";

// Initialize Redis client
const redis = new Redis({
  url: env.KV_REST_API_TOKEN,
  token: env.KV_REST_API_TOKEN,
});

// Verify webhook signature from Linear
export function verifySignature(signature: string, body: string): boolean {
  if (!process.env.LINEAR_WEBHOOK_SECRET) {
    console.error("LINEAR_WEBHOOK_SECRET not set");
    return false;
  }

  const hmac = crypto.createHmac("sha256", process.env.LINEAR_WEBHOOK_SECRET);
  hmac.update(body);
  const computedSignature = hmac.digest("hex");

  return signature === computedSignature;
}

// Main webhook handler
export async function handleWebhook(req: VercelRequest, res: VercelResponse) {
  // Only handle POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const rawBody = JSON.stringify(req.body);
  const signature = req.headers["linear-signature"] as string;

  // Verify webhook signature
  if (!signature || !verifySignature(signature, rawBody)) {
    console.error("Invalid webhook signature");
    return res.status(401).json({ error: "Invalid signature" });
  }

  const payload = req.body;
  console.log("Received webhook:", JSON.stringify(payload, null, 2));

  try {
    // Get stored tokens from Redis
    const orgId = payload.organizationId;
    const accessToken = (await redis.get(
      `linear:${orgId}:accessToken`,
    )) as string;
    const appUserId = (await redis.get(`linear:${orgId}:appUserId`)) as string;

    if (!accessToken) {
      console.error(`No access token found for organization ${orgId}`);
      return res.status(500).json({ error: "Authentication missing" });
    }

    // Initialize Linear client with stored credentials
    const linearClient = new LinearClient({ accessToken });

    // Process the webhook based on action type
    if (payload.type === "AppUserNotification") {
      switch (payload.action) {
        case "issueMention":
          console.log("Processing issue mention");
          await handleIssueMention(payload, linearClient, appUserId);
          break;
        case "issueCommentMention":
          console.log("Processing comment mention");
          await handleCommentMention(payload, linearClient, appUserId);
          break;
        case "issueCreated":
        case "issueUpdated":
          console.log(`Processing issue ${payload.action}`);
          await handleIssueCreated(payload, linearClient, appUserId);
          break;
        case "issueNewComment":
          console.log("Processing new comment");
          await handleNewComment(payload, linearClient, appUserId);
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

// Handle when the agent is mentioned in an issue
async function handleIssueMention(
  payload: any,
  linearClient: LinearClient,
  appUserId: string,
) {
  const { notification } = payload;
  const issueId = notification.issueId;

  if (!issueId) {
    console.error("No issue ID found in notification");
    return;
  }

  try {
    // Get the issue
    const issue = await linearClient.issue(issueId);

    // Get context about the issue
    const context = await getIssueContext(issue, linearClient);

    // Find the mention comment
    const comments = await issue.comments();
    const mentionComment = comments.nodes.find(
      (comment) =>
        comment.body.includes(`@${appUserId}`) &&
        new Date(comment.createdAt) > new Date(Date.now() - 60000),
    );

    if (!mentionComment) {
      console.error("Could not find mention comment");
      // Fallback to analyzing the issue
      const analysis = await analyzeIssue(context);

      await linearClient.createComment({
        issueId,
        body: analysis,
      });
      return;
    }

    // Add reaction to show we're processing
    await linearClient.createReaction({
      commentId: mentionComment.id,
      emoji: "thinking_face",
    });

    // Extract question from the comment
    const question = extractQuestion(mentionComment.body, appUserId);

    // Answer the user's question
    const answer = await answerUserQuestion(question, context);

    // Reply to the comment
    await linearClient.createComment({
      issueId,
      body: answer,
      parentId: mentionComment.id, // Reply directly to the comment
    });

    // Add completion reaction
    await linearClient.createReaction({
      commentId: mentionComment.id,
      emoji: "white_check_mark",
    });
  } catch (error) {
    console.error("Error handling issue mention:", error);
  }
}

// Handle when the agent is mentioned in a comment
async function handleCommentMention(
  payload: any,
  linearClient: LinearClient,
  appUserId: string,
) {
  const { notification } = payload;
  const commentId = notification.commentId;

  if (!commentId) {
    console.error("No comment ID found in notification");
    return;
  }

  try {
    // Get the comment
    const comment = await linearClient.comment(commentId);

    // Add acknowledgment reaction
    await linearClient.createReaction({
      commentId,
      emoji: "eyes",
    });

    // Get the associated issue
    const issue = await comment.issue;
    if (!issue) {
      console.error("Could not find associated issue");
      return;
    }

    // Get context about the issue
    const context = await getIssueContext(issue, linearClient);

    // Extract question from the comment
    const question = extractQuestion(comment.body, appUserId);

    // Check for special commands
    if (question.toLowerCase().includes("refine")) {
      // Generate issue refinement suggestions
      const refinement = await analyzeIssue(context);

      // Reply with analysis
      await linearClient.createComment({
        issueId: issue.id,
        body: refinement,
        parentId: commentId,
      });
    } else {
      // Answer the question
      const answer = await answerUserQuestion(question, context);

      // Reply to the comment
      await linearClient.createComment({
        issueId: issue.id,
        body: answer,
        parentId: commentId,
      });
    }

    // Add completion reaction
    await linearClient.createReaction({
      commentId,
      emoji: "white_check_mark",
    });
  } catch (error) {
    console.error("Error handling comment mention:", error);
  }
}

// Handle newly created issues
async function handleIssueCreated(
  payload: any,
  linearClient: LinearClient,
  appUserId: string,
) {
  const { notification } = payload;
  const issueId = notification.issueId;

  if (!issueId) {
    console.error("No issue ID found in notification");
    return;
  }

  try {
    // Get the issue
    const issue = await linearClient.issue(issueId);

    // Skip if issue already has detailed description
    if (issue.description && issue.description.length > 200) {
      return;
    }

    // Get context about the issue
    const context = await getIssueContext(issue, linearClient);

    // Analyze the issue for missing information
    const analysis = await analyzeIssue(context);

    // Only comment if there are significant gaps
    if (
      analysis.includes("Missing") ||
      analysis.includes("Could be improved")
    ) {
      await linearClient.createComment({
        issueId,
        body: `I've analyzed this issue and noticed it might benefit from some additional information:\n\n${analysis}\n\nReply with "@Context refine" for more detailed guidance.`,
      });
    }
  } catch (error) {
    console.error("Error handling issue created:", error);
  }
}

// Handle new comments
async function handleNewComment(
  payload: any,
  linearClient: LinearClient,
  appUserId: string,
) {
  const { notification } = payload;
  const commentId = notification.commentId;

  if (!commentId) {
    console.error("No comment ID found in notification");
    return;
  }

  try {
    // Get the comment
    const comment = await linearClient.comment(commentId);

    // Check if the comment contains a command for our agent
    if (
      comment.body.includes("@Context") ||
      comment.body.includes(`@${appUserId}`)
    ) {
      // This will be handled by the mention handlers, so we can ignore
      return;
    }

    // Otherwise, we don't need to process this comment
  } catch (error) {
    console.error("Error handling new comment:", error);
  }
}

// Helper to extract the question from a comment
function extractQuestion(commentBody: string, appUserId: string): string {
  // Remove the mention
  let text = commentBody
    .replace(`@${appUserId}`, "")
    .replace("@Context", "")
    .trim();

  // If there are quotes, extract the content inside
  const quoteMatch = text.match(/"([^"]*)"/);
  if (quoteMatch && quoteMatch[1]) {
    return quoteMatch[1];
  }

  return text;
}
