import crypto from "node:crypto";
import { LinearClient, Notification } from "@linear/sdk";
import { Redis } from "@upstash/redis";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getIssueContext, respondToMessage } from "../src/ai.js";
import { env } from "../src/env.js";

// Initialize Redis client
const redis = new Redis({
  url: env.KV_REST_API_URL,
  token: env.KV_REST_API_TOKEN,
});

// Verify webhook signature from Linear
export function verifySignature(signature: string, body: string): boolean {
  const hmac = crypto.createHmac("sha256", env.WEBHOOK_SIGNING_SECRET);
  hmac.update(body);
  const computedSignature = hmac.digest("hex");

  return signature === computedSignature;
}

// Main webhook handler
export default async function handler(req: VercelRequest, res: VercelResponse) {
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
        case "issueAssignedToYou":
          console.log("Processing issue assigned to agent");
          await handleIssueAssigned(payload, linearClient, appUserId);
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
  payload: { notification: { issueId: string } },
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

    // Add reaction to the issue
    await linearClient.createReaction({
      issueId: issue.id,
      emoji: "eyes",
    });

    // Get context about the issue
    const context = await getIssueContext(issue, linearClient);

    // Find the mention comment
    const comments = await issue.comments();
    const mentionComment = comments.nodes.find(
      (comment) =>
        comment.body.includes(`@${appUserId}`) &&
        new Date(comment.createdAt) > new Date(Date.now() - 60000),
    );

    // Extract question from the comment or use the issue title
    const question = mentionComment
      ? extractQuestion(mentionComment.body, appUserId)
      : issue.title;

    // Generate a response
    const response = await respondToMessage(question, context);

    // Reply to the comment or create a new one
    await linearClient.createComment({
      issueId,
      body: response,
      parentId: mentionComment ? mentionComment.id : undefined,
    });

    // Add completion reaction to the issue
    await linearClient.createReaction({
      issueId: issue.id,
      emoji: "white_check_mark",
    });
  } catch (error) {
    console.error("Error handling issue mention:", error);
    try {
      // Add error reaction to the issue
      await linearClient.createReaction({
        issueId,
        emoji: "x",
      });
    } catch (e) {
      console.error("Failed to add error reaction:", e);
    }
  }
}

// Handle when the agent is mentioned in a comment
async function handleCommentMention(
  payload: { notification: { commentId: string; parentCommentId?: string } },
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
    const comment = await linearClient.comment({ id: commentId });

    // Get the associated issue
    const issue = await comment.issue;
    if (!issue) {
      console.error("Could not find associated issue");
      return;
    }

    // Add reactions to the issue
    await linearClient.createReaction({
      commentId,
      emoji: "eyes",
    });

    // Get context about the issue
    const context = await getIssueContext(issue, linearClient);

    // Extract question from the comment
    const question = extractQuestion(comment.body, appUserId);

    // Generate response
    const response = await respondToMessage(question, context);

    // Reply to the comment
    await linearClient.createComment({
      issueId: issue.id,
      body: response,
      parentId: notification?.parentCommentId || commentId,
    });

    // Add completion reaction to the issue
    await linearClient.createReaction({
      commentId,
      emoji: "white_check_mark",
    });
  } catch (error) {
    console.error("Error handling comment mention:", error);
    try {
      // Get the comment to find the issue
      const comment = await linearClient.comment({ id: commentId });
      const issue = await comment.issue;
      if (issue) {
        // Add error reaction to the issue
        await linearClient.createReaction({
          issueId: issue.id,
          emoji: "x",
        });
      }
    } catch (e) {
      console.error("Failed to add error reaction:", e);
    }
  }
}

// Handle newly created issues
async function handleIssueCreated(
  payload: { notification: { issueId: string } },
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

    // Add processing reaction to the issue
    await linearClient.createReaction({
      issueId: issue.id,
      emoji: "eyes",
    });

    // Get context about the issue
    const context = await getIssueContext(issue, linearClient);

    // Create a default question for analysis
    const question = "Please analyze this issue for missing information";

    // Analyze the issue
    const analysis = await respondToMessage(question, context);

    // Only comment if there are issues to address
    if (
      analysis.includes("missing") ||
      analysis.includes("could be improved")
    ) {
      await linearClient.createComment({
        issueId,
        body: analysis,
      });
    }

    // Add completion reaction to the issue
    await linearClient.createReaction({
      issueId: issue.id,
      emoji: "white_check_mark",
    });
  } catch (error) {
    console.error("Error handling issue created:", error);
    try {
      // Add error reaction to the issue
      await linearClient.createReaction({
        issueId,
        emoji: "x",
      });
    } catch (e) {
      console.error("Failed to add error reaction:", e);
    }
  }
}

// Handle new comments
async function handleNewComment(
  payload: { notification: { commentId: string } },
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
    const comment = await linearClient.comment({ id: commentId });

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

// Handle when an issue is assigned to the agent
async function handleIssueAssigned(
  payload: { notification: { issueId: string } },
  linearClient: LinearClient,
  appUserId: string,
) {
  const { notification } = payload;
  const issueId = notification.issueId;
  if (!issueId) {
    console.error("No issue ID found in notification");
    return;
  }

  let originalAssigneeId: string | null | undefined = null;

  try {
    console.log(`Processing issue assignment for issue: ${issueId}`);

    // Get the issue
    const issue = await linearClient.issue(issueId);
    console.log(`Current issue assignee: ${issue.assigneeId}`);

    // Get the issue history to find the previous assignee
    const issueHistory = await issue.history();
    console.log(`Retrieved history with ${issueHistory.nodes.length} events`);

    // Log all history events for debugging
    console.log(
      "All history events:",
      JSON.stringify(issueHistory.nodes, null, 2),
    );

    // Log all history entries related to assignee changes for debugging
    const allAssigneeChanges = issueHistory.nodes.filter(
      (event: any) =>
        event.type === "issue" &&
        event.action === "update" &&
        event.data &&
        (event.data.assigneeId !== undefined ||
          event.fromAssigneeId !== undefined),
    );

    console.log(
      "All assignee change events:",
      JSON.stringify(allAssigneeChanges, null, 2),
    );

    // The most recent event should be the current assignment to appUserId
    // We want the event just before that which changed the assignee
    let foundPreviousAssignee = false;

    for (const event of allAssigneeChanges) {
      console.log(
        `Examining event: ${event.createdAt}, toAssigneeId: ${event.toAssigneeId}, fromAssigneeId: ${event.fromAssigneeId}`,
      );

      // If this is the event that assigned to our app user
      if (event.toAssigneeId === appUserId) {
        // The fromAssigneeId would be the previous assignee
        originalAssigneeId = event.fromAssigneeId;
        foundPreviousAssignee = true;
        console.log(`Found previous assignee: ${originalAssigneeId}`);
        break;
      }
    }

    if (!foundPreviousAssignee) {
      console.log("Could not determine previous assignee from history");
    }

    // Get context about the issue
    const context = await getIssueContext(issue, linearClient);

    // Add eyes reaction to the issue
    await linearClient.createReaction({
      issueId: issue.id,
      emoji: "eyes",
    });

    // Generate questions about missing critical information
    const missingInfoQuestions = await respondToMessage(
      "Based on this issue, what are the most critical pieces of information that are missing and would prevent the development team from implementing it? Only list 1-3 specific questions about the most essential missing details. If no critical information is missing, respond with 'No critical information is missing.'",
      context,
    );

    // Only comment if there's missing information
    if (!missingInfoQuestions.includes("No critical information is missing")) {
      await linearClient.createComment({
        issueId,
        body: missingInfoQuestions,
      });
    }

    // Add completion reaction to the issue
    await linearClient.createReaction({
      issueId: issue.id,
      emoji: "white_check_mark",
    });

    // Re-assign to original assignee if we found one and it's different from the app user
    if (originalAssigneeId && originalAssigneeId !== appUserId) {
      console.log(
        `Reassigning issue from ${appUserId} to original assignee ${originalAssigneeId}`,
      );
      await linearClient.updateIssue(issueId, {
        assigneeId: originalAssigneeId,
      });
      console.log(`Successfully reassigned issue to ${originalAssigneeId}`);
    } else {
      console.log(
        `Not reassigning issue. Original assignee: ${originalAssigneeId}, App user: ${appUserId}`,
      );
    }
  } catch (error) {
    console.error("Error handling assigned issue:", error);
    try {
      // Add error reaction to the issue
      await linearClient.createReaction({
        issueId,
        emoji: "x",
      });
    } catch (e) {
      console.error("Failed to add error reaction:", e);
    }
  }
}

// Helper to extract the question from a comment
function extractQuestion(commentBody: string, appUserId: string): string {
  // Remove the mention
  return commentBody
    .replace(`@${appUserId}`, "")
    .replace("@Context", "")
    .trim();
}
