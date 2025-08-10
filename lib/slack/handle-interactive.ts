import { generateResponse } from "../generate-response.js";
import { getThread, updateStatusUtil } from "./slack-utils.js";
import {
  makeSlackContextId,
  startSlackSession,
  endSlackSession,
} from "./session-manager.js";

export interface SlackInteractivePayload {
  type: "block_actions" | "shortcut" | "view_submission" | "view_closed";
  user: {
    id: string;
    username: string;
    name: string;
    team_id: string;
  };
  api_app_id: string;
  token: string;
  container?: {
    type: string;
    message_ts: string;
  };
  trigger_id: string;
  team: {
    id: string;
    domain: string;
  };
  enterprise?: any;
  is_enterprise_install: boolean;
  channel?: {
    id: string;
    name: string;
  };
  message?: {
    type: string;
    subtype?: string;
    text: string;
    ts: string;
    username?: string;
    bot_id?: string;
    blocks?: any[];
  };
  response_url?: string;
  actions?: Array<{
    action_id: string;
    block_id: string;
    text: {
      type: string;
      text: string;
      emoji?: boolean;
    };
    value?: string;
    style?: string;
    type: string;
    action_ts: string;
  }>;
}

export async function handleSlackInteractive(
  payload: SlackInteractivePayload,
  botUserId: string
) {
  try {
    console.log("Handling Slack interactive payload:", payload.type);

    // Handle different types of interactive components
    if (payload.type === "block_actions") {
      await handleBlockActions(payload, botUserId);
    } else if (payload.type === "shortcut") {
      await handleShortcut(payload, botUserId);
    } else if (payload.type === "view_submission") {
      await handleViewSubmission(payload, botUserId);
    } else {
      console.log(`Unhandled interactive payload type: ${payload.type}`);
    }
  } catch (error) {
    console.error("Error handling Slack interactive payload:", error);
  }
}

async function handleBlockActions(
  payload: SlackInteractivePayload,
  botUserId: string
) {
  if (!payload.actions || payload.actions.length === 0) {
    console.log("No actions found in block_actions payload");
    return;
  }

  const action = payload.actions[0]; // Handle the first action
  const user = payload.user;
  const channel = payload.channel;
  const message = payload.message;
  const responseUrl = payload.response_url;

  const channelId = channel?.id;
  const threadTs =
    (message as any)?.thread_ts || message?.ts || payload.container?.message_ts;

  if (!channelId || !threadTs) {
    console.warn("[interactive] Missing channel or thread timestamp; skipping");
    return;
  }

  const slackContext = { channelId, threadTs };
  const updateStatus = updateStatusUtil(channelId, threadTs);

  const contextId = makeSlackContextId(channelId, threadTs);
  const abortController = startSlackSession(contextId);

  // Build a succinct note about the interaction to append to the thread
  const noteLines = [
    `User ${user.name} (${user.username}) clicked a Slack button`,
    `Button: ${action.text?.text || action.action_id} (action_id: ${
      action.action_id
    })`,
  ];
  if (action.value) noteLines.push(`Value: ${action.value}`);
  if ((message as any)?.text)
    noteLines.push(`Origin: ${(message as any).text}`);
  if (responseUrl)
    noteLines.push(
      `response_url: ${responseUrl} (use respondToSlackInteraction to reply ephemerally or update the message)`
    );
  const interactionNote = noteLines.join("\n");

  await updateStatus("is thinking...");

  try {
    const messages = await getThread(channelId, threadTs, botUserId);
    // Append the interaction as the latest user message for continuity
    messages.push({ role: "user", content: interactionNote });

    await generateResponse(
      messages,
      updateStatus,
      undefined,
      slackContext,
      abortController.signal
    );
  } catch (err) {
    console.error("[interactive] handler error:", err);
  } finally {
    try {
      await updateStatus("");
    } catch {}
    endSlackSession(contextId, abortController);
  }
}

async function handleShortcut(
  payload: SlackInteractivePayload,
  botUserId: string
) {
  // Handle global shortcuts or message shortcuts
  console.log("Handling shortcut:", payload);

  // For now, just log - can be extended later
  console.log("Shortcut handling not yet implemented");
}

async function handleViewSubmission(
  payload: SlackInteractivePayload,
  botUserId: string
) {
  // Handle modal submissions
  console.log("Handling view submission:", payload);

  // For now, just log - can be extended later
  console.log("View submission handling not yet implemented");
}
