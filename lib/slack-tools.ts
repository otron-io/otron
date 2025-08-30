import * as slackUtils from "./slack/slack-utils.js";

// Slack tool execution functions

export const executeSendSlackMessage = async (
  {
    channel,
    text,
    threadTs,
  }: { channel: string; text: string; threadTs: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is sending message to ${channel}...`);

  await slackUtils.sendMessage(channel, text, threadTs || undefined);
  return {
    success: true,
    message: `Sent message to ${channel}`,
  };
};

export const executeSendDirectMessage = async (
  { userIdOrEmail, text }: { userIdOrEmail: string; text: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is sending direct message to ${userIdOrEmail}...`);

  await slackUtils.sendDirectMessage(userIdOrEmail, text);
  return {
    success: true,
    message: `Sent direct message to ${userIdOrEmail}`,
  };
};

export const executeSendChannelMessage = async (
  {
    channelNameOrId,
    text,
    threadTs,
  }: { channelNameOrId: string; text: string; threadTs: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is sending message to channel ${channelNameOrId}...`);

  await slackUtils.sendChannelMessage(
    channelNameOrId,
    text,
    threadTs || undefined
  );
  return {
    success: true,
    message: `Sent message to channel ${channelNameOrId}`,
  };
};

export const executeAddSlackReaction = async (
  {
    channel,
    timestamp,
    emoji,
  }: { channel: string; timestamp: string; emoji: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is adding reaction ${emoji} to message...`);

  await slackUtils.addReaction(channel, timestamp, emoji);
  return {
    success: true,
    message: `Added reaction ${emoji} to message`,
  };
};

export const executeRemoveSlackReaction = async (
  {
    channel,
    timestamp,
    emoji,
  }: { channel: string; timestamp: string; emoji: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is removing reaction ${emoji} from message...`);

  await slackUtils.removeReaction(channel, timestamp, emoji);
  return {
    success: true,
    message: `Removed reaction ${emoji} from message`,
  };
};

export const executeGetSlackChannelHistory = async (
  { channel, limit }: { channel: string; limit: number },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is getting channel history for ${channel}...`);

  const history = await slackUtils.getBriefChannelHistory(
    channel,
    limit === 0 ? undefined : limit
  );
  return { history };
};

export const executeGetSlackThread = async (
  { channel, threadTs }: { channel: string; threadTs: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is getting thread from ${channel}...`);

  const botUserId = await slackUtils.getBotId();
  const thread = await slackUtils.getThread(channel, threadTs, botUserId);
  return { thread };
};

export const executeUpdateSlackMessage = async (
  {
    channel,
    timestamp,
    text,
  }: { channel: string; timestamp: string; text: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is updating message in ${channel}...`);

  await slackUtils.updateMessage(channel, timestamp, text);
  return {
    success: true,
    message: `Updated message in ${channel}`,
  };
};

export const executeDeleteSlackMessage = async (
  { channel, timestamp }: { channel: string; timestamp: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is deleting message from ${channel}...`);

  await slackUtils.deleteMessage(channel, timestamp);
  return {
    success: true,
    message: `Deleted message from ${channel}`,
  };
};

export const executeGetSlackUserInfo = async (
  { userIdOrEmail }: { userIdOrEmail: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is getting user info for ${userIdOrEmail}...`);

  let userInfo;
  if (userIdOrEmail.includes("@")) {
    userInfo = await slackUtils.getUserByEmail(userIdOrEmail);
  } else {
    userInfo = await slackUtils.getUserInfo(userIdOrEmail);
  }

  return { userInfo };
};

export const executeGetSlackChannelInfo = async (
  { channelNameOrId }: { channelNameOrId: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is getting channel info for ${channelNameOrId}...`);

  let channelInfo;
  if (channelNameOrId.startsWith("#")) {
    const channelName = channelNameOrId.slice(1);
    channelInfo = await slackUtils.getChannelByName(channelName);
  } else {
    channelInfo = await slackUtils.getChannelInfo(channelNameOrId);
  }

  return { channelInfo };
};

export const executeJoinSlackChannel = async (
  { channelId }: { channelId: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is joining channel ${channelId}...`);

  await slackUtils.joinChannel(channelId);
  return {
    success: true,
    message: `Joined channel ${channelId}`,
  };
};

export const executeSearchSlackMessages = async (
  { query, count }: { query: string; count: number },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is searching for messages: "${query}"...`);

  const results = await slackUtils.searchMessages(query, {
    count: count === 0 ? undefined : count,
  });
  return { results };
};

export const executeGetSlackPermalink = async (
  { channel, messageTs }: { channel: string; messageTs: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is getting permalink for message...`);

  const permalink = await slackUtils.getPermalink(channel, messageTs);
  return { permalink };
};

export const executeSetSlackStatus = async (
  {
    statusText,
    statusEmoji,
    statusExpiration,
  }: { statusText: string; statusEmoji: string; statusExpiration: number },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is setting status to "${statusText}"...`);

  await slackUtils.setStatus(
    statusText,
    statusEmoji || undefined,
    statusExpiration === 0 ? undefined : statusExpiration
  );
  return {
    success: true,
    message: `Set status to "${statusText}"`,
  };
};

export const executePinSlackMessage = async (
  { channel, timestamp }: { channel: string; timestamp: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is pinning message in ${channel}...`);

  await slackUtils.pinMessage(channel, timestamp);
  return {
    success: true,
    message: `Pinned message in ${channel}`,
  };
};

export const executeUnpinSlackMessage = async (
  { channel, timestamp }: { channel: string; timestamp: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is unpinning message in ${channel}...`);

  await slackUtils.unpinMessage(channel, timestamp);
  return {
    success: true,
    message: `Unpinned message in ${channel}`,
  };
};

export const executeSendRichSlackMessage = async (
  {
    channel,
    blocks,
    text,
    threadTs,
  }: {
    channel: string;
    blocks: any[];
    text: string;
    threadTs: string;
  },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is sending rich message to ${channel}...`);

  await slackUtils.sendRichMessage(
    channel,
    blocks,
    text || undefined,
    threadTs || undefined
  );
  return {
    success: true,
    message: `Sent rich message to ${channel}`,
  };
};

export const executeSendRichChannelMessage = async (
  {
    channelNameOrId,
    blocks,
    text,
    threadTs,
  }: {
    channelNameOrId: string;
    blocks: any[];
    text: string;
    threadTs: string;
  },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is sending rich message to channel ${channelNameOrId}...`);

  // Handle channel name resolution
  let channelId = channelNameOrId;
  if (channelNameOrId.startsWith("#")) {
    const channelName = channelNameOrId.slice(1);
    const channelInfo = await slackUtils.getChannelByName(channelName);
    if (!channelInfo?.id) {
      throw new Error(`Channel ${channelName} not found`);
    }
    channelId = channelInfo.id;
  }

  await slackUtils.sendRichMessage(
    channelId,
    blocks,
    text || undefined,
    threadTs || undefined
  );
  return {
    success: true,
    message: `Sent rich message to channel ${channelNameOrId}`,
  };
};

export const executeSendRichDirectMessage = async (
  {
    userIdOrEmail,
    blocks,
    text,
  }: {
    userIdOrEmail: string;
    blocks: any[];
    text: string;
  },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is sending rich direct message to ${userIdOrEmail}...`);

  // Handle user resolution
  let userId = userIdOrEmail;
  if (userIdOrEmail.includes("@")) {
    const userInfo = await slackUtils.getUserByEmail(userIdOrEmail);
    if (!userInfo?.id) {
      throw new Error(`User with email ${userIdOrEmail} not found`);
    }
    userId = userInfo.id;
  }

  // Open a DM channel with the user
  const { channel } = await slackUtils.client.conversations.open({
    users: userId,
  });

  if (!channel?.id) {
    throw new Error("Failed to open DM channel");
  }

  await slackUtils.sendRichMessage(channel.id, blocks, text || undefined);
  return {
    success: true,
    message: `Sent rich direct message to ${userIdOrEmail}`,
  };
};

export async function executeCreateFormattedSlackMessage(
  args: {
    channel: string;
    title: string;
    content: string;
    fields: Array<{ label: string; value: string }>;
    context: string;
    actions: Array<{
      text: string;
      action_id: string;
      style: "primary" | "danger";
    }>;
    thread_ts: string;
  },
  updateStatus?: (status: string) => void
): Promise<string> {
  try {
    const { channel, title, content, fields, context, actions, thread_ts } =
      args;

    updateStatus?.(`is creating formatted message for ${channel}...`);

    const blocks: any[] = [];

    // Add header if title provided
    if (title && title.trim()) {
      blocks.push({
        type: "header",
        text: {
          type: "plain_text",
          text: title,
        },
      });
    }

    // Add main content
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: content,
      },
    });

    // Add fields if provided
    if (fields && fields.length > 0) {
      blocks.push({
        type: "section",
        fields: fields.map((field) => ({
          type: "mrkdwn",
          text: `*${field.label}:*\n${field.value}`,
        })),
      });
    }

    // Add divider if we have context or actions
    if ((context && context.trim()) || (actions && actions.length > 0)) {
      blocks.push({ type: "divider" });
    }

    // Add context if provided
    if (context && context.trim()) {
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: context,
          },
        ],
      });
    }

    // Add actions if provided
    if (actions && actions.length > 0) {
      blocks.push({
        type: "actions",
        elements: actions.map((action) => ({
          type: "button",
          text: {
            type: "plain_text",
            text: action.text,
          },
          action_id: action.action_id,
          style: action.style,
        })),
      });
    }

    await slackUtils.sendRichMessage(
      channel,
      blocks,
      undefined,
      thread_ts || undefined
    );

    return `Formatted message sent successfully to ${channel}`;
  } catch (error) {
    console.error("Error sending formatted Slack message:", error);
    return `Error sending formatted message: ${
      error instanceof Error ? error.message : "Unknown error"
    }`;
  }
}

export const executeRespondToSlackInteraction = async (
  {
    responseUrl,
    text,
    blocks,
    replaceOriginal,
    deleteOriginal,
    responseType,
  }: {
    responseUrl: string;
    text?: string;
    blocks?: any[];
    replaceOriginal?: boolean;
    deleteOriginal?: boolean;
    responseType?: "ephemeral" | "in_channel";
  },
  updateStatus?: (status: string) => void
) => {
  try {
    updateStatus?.("Responding to Slack interaction...");

    const payload: any = {};

    if (deleteOriginal) {
      payload.delete_original = true;
    } else {
      if (text) payload.text = text;
      if (blocks) payload.blocks = blocks;
      if (replaceOriginal) payload.replace_original = true;
      if (responseType) payload.response_type = responseType;
    }

    const response = await fetch(responseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return {
      success: true,
      message: "Successfully responded to Slack interaction",
    };
  } catch (error) {
    console.error("Error responding to Slack interaction:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      message: "Failed to respond to Slack interaction",
    };
  }
};

/**
 * Create a statically defined Slack workflow with one step (trigger_otron)
 * and a scheduled trigger that runs the workflow on a cron.
 *
 * Requirements on the Slack app:
 * - App has the Automation (workflows) feature enabled
 * - Token has permissions to create workflows and triggers
 * - Our backend is subscribed to function_executed and will process the step
 */
export const executeCreateSlackWorkflowWithSchedule = async (
  {
    workflowName,
    callbackId,
    description,
    instruction,
    channelId,
    human,
    cron,
    timezone,
    startTime,
    endTime,
  }: {
    workflowName: string;
    callbackId: string; // must be unique per workflow in app
    description?: string;
    instruction: string;
    channelId: string;
    human?: string;
    cron: string; // standard 5-field cron expression
    timezone: string; // IANA timezone, e.g. "America/Los_Angeles"
    startTime?: string; // ISO8601; if omitted, now
    endTime?: string; // ISO8601; optional automatic expiry of schedule
  },
  updateStatus?: (status: string) => void
) => {
  const token = process.env.SLACK_BOT_TOKEN as string;
  if (!token) {
    return {
      success: false,
      error: "Missing SLACK_BOT_TOKEN",
    };
  }

  try {
    updateStatus?.(`is creating workflow ${workflowName}...`);

    // 1) Create workflow with a single step pointing to our custom function id
    // Note: Slack API shapes may evolve; we keep payload conservative.
    const wfRes = await fetch("https://slack.com/api/workflows.create", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workflow: {
          title: workflowName,
          callback_id: callbackId,
          description: description || "",
          input_parameters: {
            required: ["instruction", "channel"],
            properties: {
              instruction: {
                type: "string",
                description: "Instruction for Otron",
              },
              channel: {
                type: "slack#/types/channel_id",
                description: "Target channel",
              },
              human: {
                type: "slack#/types/user_id",
                description: "Requesting user",
              },
            },
          },
          steps: [
            {
              id: "trigger_otron_step",
              function_id: "trigger_otron",
              inputs: {
                instruction: { value: "{{workflow.inputs.instruction}}" },
                channel: { value: "{{workflow.inputs.channel}}" },
                human: { value: "{{workflow.inputs.human}}" },
              },
            },
          ],
        },
      }),
    });

    const wfJson: any = await wfRes.json();
    if (!wfJson.ok) {
      throw new Error(
        `workflows.create failed: ${wfJson.error || wfRes.status}`
      );
    }

    const workflowId = wfJson.workflow?.id || wfJson.id || callbackId;

    // 2) Create scheduled trigger for the workflow
    updateStatus?.("is creating scheduled trigger...");

    const schedule: any = {
      timezone,
      start_time: startTime || new Date().toISOString(),
      frequency: {
        type: "cron",
        expression: cron,
      },
    } as const;
    if (endTime) schedule.end_time = endTime;

    const trigRes = await fetch(
      "https://slack.com/api/workflows.triggers.create",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "scheduled",
          workflow: { callback_id: callbackId },
          inputs: {
            instruction: { value: instruction },
            channel: { value: channelId },
            ...(human ? { human: { value: human } } : {}),
          },
          schedule,
        }),
      }
    );

    const trigJson: any = await trigRes.json();
    if (!trigJson.ok) {
      throw new Error(
        `workflows.triggers.create failed: ${trigJson.error || trigRes.status}`
      );
    }

    return {
      success: true,
      workflowId,
      triggerId: trigJson.trigger?.id || trigJson.id,
      message: `Created workflow ${workflowId} with scheduled trigger`,
    };
  } catch (error) {
    console.error("Error creating Slack workflow and trigger:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
};

/**
 * Delete a workflow and/or its triggers.
 */
export const executeDeleteSlackWorkflowAndTriggers = async (
  {
    callbackId,
    workflowId,
    triggerIds,
    deleteWorkflow,
    deleteTriggers,
  }: {
    callbackId?: string;
    workflowId?: string;
    triggerIds?: string[];
    deleteWorkflow?: boolean; // default true if workflowId or callbackId present
    deleteTriggers?: boolean; // default true if triggerIds present
  },
  updateStatus?: (status: string) => void
) => {
  const token = process.env.SLACK_BOT_TOKEN as string;
  if (!token) {
    return { success: false, error: "Missing SLACK_BOT_TOKEN" };
  }

  try {
    const results: any = { deletedTriggers: [], deletedWorkflow: false };

    if (triggerIds && (deleteTriggers ?? true)) {
      for (const id of triggerIds) {
        updateStatus?.(`is deleting trigger ${id}...`);
        const res = await fetch(
          "https://slack.com/api/workflows.triggers.delete",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ trigger_id: id }),
          }
        );
        const json: any = await res.json();
        if (!json.ok) {
          throw new Error(
            `workflows.triggers.delete failed for ${id}: ${
              json.error || res.status
            }`
          );
        }
        results.deletedTriggers.push(id);
      }
    }

    if ((workflowId || callbackId) && (deleteWorkflow ?? true)) {
      updateStatus?.("is deleting workflow...");
      const res = await fetch("https://slack.com/api/workflows.delete", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workflow: workflowId
            ? { id: workflowId }
            : { callback_id: callbackId },
        }),
      });
      const json: any = await res.json();
      if (!json.ok) {
        throw new Error(`workflows.delete failed: ${json.error || res.status}`);
      }
      results.deletedWorkflow = true;
    }

    return { success: true, ...results };
  } catch (error) {
    console.error("Error deleting Slack workflow/trigger:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
};
