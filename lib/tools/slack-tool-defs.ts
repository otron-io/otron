import { tool } from "ai";
import { z } from "zod";
import {
  executeAddSlackReaction,
  executeRemoveSlackReaction,
  executeGetSlackChannelHistory,
  executeGetSlackThread,
  executeUpdateSlackMessage,
  executeDeleteSlackMessage,
  executeGetSlackUserInfo,
  executeGetSlackChannelInfo,
  executeJoinSlackChannel,
  executeSetSlackStatus,
  executePinSlackMessage,
  executeUnpinSlackMessage,
  executeSendRichSlackMessage,
  executeSendRichChannelMessage,
  executeSendRichDirectMessage,
  executeCreateFormattedSlackMessage,
  executeRespondToSlackInteraction,
} from "../slack-tools.js";

type ToolExecutorWrapper = (
  name: string,
  fn: Function
) => (...args: any[]) => any;

/**
 * Shared Block Kit blocks schema used by rich message tools.
 */
const slackBlockKitBlocks = z
  .array(
    z.union([
      // Section block with text
      z
        .object({
          type: z.literal("section"),
          text: z.object({
            type: z.enum(["mrkdwn", "plain_text"]),
            text: z.string(),
          }),
        })
        .strict(),
      // Section block with fields
      z
        .object({
          type: z.literal("section"),
          fields: z.array(
            z.object({
              type: z.enum(["mrkdwn", "plain_text"]),
              text: z.string(),
            })
          ),
        })
        .strict(),
      // Header block
      z
        .object({
          type: z.literal("header"),
          text: z.object({
            type: z.literal("plain_text"),
            text: z.string(),
          }),
        })
        .strict(),
      // Divider block
      z
        .object({
          type: z.literal("divider"),
        })
        .strict(),
      // Context block
      z
        .object({
          type: z.literal("context"),
          elements: z.array(
            z.object({
              type: z.enum(["mrkdwn", "plain_text"]),
              text: z.string(),
            })
          ),
        })
        .strict(),
      // Actions block
      z
        .object({
          type: z.literal("actions"),
          elements: z.array(
            z.object({
              type: z.literal("button"),
              text: z.object({
                type: z.literal("plain_text"),
                text: z.string(),
              }),
              action_id: z.string(),
              style: z.enum(["primary", "danger"]),
            })
          ),
        })
        .strict(),
      // Image block
      z
        .object({
          type: z.literal("image"),
          image_url: z.string(),
          alt_text: z.string(),
        })
        .strict(),
    ])
  )
  .describe(
    "Array of Slack Block Kit blocks for rich formatting. Supported types: section, header, divider, context, actions, image"
  );

export function createSlackTools(
  executor: ToolExecutorWrapper,
  updateStatus?: (status: string) => void
) {
  return {
    addSlackReaction: tool({
      description: "Add a reaction emoji to a Slack message",
      parameters: z.object({
        channel: z.string().describe("The channel ID"),
        timestamp: z.string().describe("The message timestamp"),
        emoji: z
          .string()
          .describe('The emoji name (without colons, e.g., "thumbsup")'),
      }),
      execute: executor("addSlackReaction", (params: any) =>
        executeAddSlackReaction(params, updateStatus)
      ),
    }),
    removeSlackReaction: tool({
      description: "Remove a reaction emoji from a Slack message",
      parameters: z.object({
        channel: z.string().describe("The channel ID"),
        timestamp: z.string().describe("The message timestamp"),
        emoji: z
          .string()
          .describe('The emoji name (without colons, e.g., "thumbsup")'),
      }),
      execute: executor("removeSlackReaction", (params: any) =>
        executeRemoveSlackReaction(params, updateStatus)
      ),
    }),
    getSlackChannelHistory: tool({
      description: "Get recent message history from a Slack channel",
      parameters: z.object({
        channel: z.string().describe("The channel ID"),
        limit: z
          .number()
          .describe(
            "Number of messages to retrieve (default: 10). Use 10 if not specified."
          ),
      }),
      execute: executor("getSlackChannelHistory", (params: any) =>
        executeGetSlackChannelHistory(params, updateStatus)
      ),
    }),
    getSlackThread: tool({
      description: "Get all messages in a Slack thread",
      parameters: z.object({
        channel: z.string().describe("The channel ID"),
        threadTs: z.string().describe("The thread timestamp"),
      }),
      execute: executor("getSlackThread", (params: any) =>
        executeGetSlackThread(params, updateStatus)
      ),
    }),
    updateSlackMessage: tool({
      description: "Update an existing Slack message",
      parameters: z.object({
        channel: z.string().describe("The channel ID"),
        timestamp: z.string().describe("The message timestamp"),
        text: z.string().describe("The new message text"),
      }),
      execute: executor("updateSlackMessage", (params: any) =>
        executeUpdateSlackMessage(params, updateStatus)
      ),
    }),
    deleteSlackMessage: tool({
      description: "Delete a Slack message",
      parameters: z.object({
        channel: z.string().describe("The channel ID"),
        timestamp: z.string().describe("The message timestamp"),
      }),
      execute: executor("deleteSlackMessage", (params: any) =>
        executeDeleteSlackMessage(params, updateStatus)
      ),
    }),
    getSlackUserInfo: tool({
      description: "Get information about a Slack user",
      parameters: z.object({
        userIdOrEmail: z
          .string()
          .describe("User ID or email address to look up"),
      }),
      execute: executor("getSlackUserInfo", (params: any) =>
        executeGetSlackUserInfo(params, updateStatus)
      ),
    }),
    getSlackChannelInfo: tool({
      description: "Get information about a Slack channel",
      parameters: z.object({
        channelNameOrId: z
          .string()
          .describe("Channel name (with or without #) or channel ID"),
      }),
      execute: executor("getSlackChannelInfo", (params: any) =>
        executeGetSlackChannelInfo(params, updateStatus)
      ),
    }),
    joinSlackChannel: tool({
      description: "Join a Slack channel",
      parameters: z.object({
        channelId: z.string().describe("The channel ID to join"),
      }),
      execute: executor("joinSlackChannel", (params: any) =>
        executeJoinSlackChannel(params, updateStatus)
      ),
    }),
    setSlackStatus: tool({
      description: "Set the bot user status in Slack",
      parameters: z.object({
        statusText: z.string().describe("The status text to set"),
        statusEmoji: z
          .string()
          .describe(
            'Optional status emoji (e.g., ":robot_face:"). Leave empty if not setting an emoji.'
          ),
        statusExpiration: z
          .number()
          .describe(
            "Optional expiration timestamp (Unix timestamp). Use 0 if no expiration."
          ),
      }),
      execute: executor("setSlackStatus", (params: any) =>
        executeSetSlackStatus(params, updateStatus)
      ),
    }),
    pinSlackMessage: tool({
      description: "Pin a message to a Slack channel",
      parameters: z.object({
        channel: z.string().describe("The channel ID"),
        timestamp: z.string().describe("The message timestamp"),
      }),
      execute: executor("pinSlackMessage", (params: any) =>
        executePinSlackMessage(params, updateStatus)
      ),
    }),
    unpinSlackMessage: tool({
      description: "Unpin a message from a Slack channel",
      parameters: z.object({
        channel: z.string().describe("The channel ID"),
        timestamp: z.string().describe("The message timestamp"),
      }),
      execute: executor("unpinSlackMessage", (params: any) =>
        executeUnpinSlackMessage(params, updateStatus)
      ),
    }),
    sendRichSlackMessage: tool({
      description:
        "Send a rich formatted message using Slack Block Kit to a specific channel. Use this for complex layouts, buttons, images, and structured content.",
      parameters: z.object({
        channel: z.string().describe("The channel ID to send the message to"),
        blocks: slackBlockKitBlocks,
        text: z
          .string()
          .describe(
            "Fallback text for notifications (leave empty string if not needed)"
          ),
        threadTs: z
          .string()
          .describe(
            "Thread timestamp to reply in a thread (leave empty string if not replying to a thread)"
          ),
        postTimes: z
          .array(z.number())
          .describe(
            "Optional array of Unix seconds to schedule this message multiple times (max 10). Provide empty array to send immediately."
          ),
      }),
      execute: executor("sendRichSlackMessage", (params: any) =>
        executeSendRichSlackMessage(params, updateStatus)
      ),
    }),
    sendRichChannelMessage: tool({
      description:
        "Send a rich formatted message using Slack Block Kit to a channel by name or ID. Use this for complex layouts, buttons, images, and structured content.",
      parameters: z.object({
        channelNameOrId: z
          .string()
          .describe("Channel name (with or without #) or channel ID"),
        blocks: slackBlockKitBlocks,
        text: z
          .string()
          .describe(
            "Fallback text for notifications (leave empty string if not needed)"
          ),
        threadTs: z
          .string()
          .describe(
            "Thread timestamp to reply in a thread (leave empty string if not replying to a thread)"
          ),
        postTimes: z
          .array(z.number())
          .describe(
            "Optional array of Unix seconds to schedule this message multiple times (max 10). Provide empty array to send immediately."
          ),
      }),
      execute: executor("sendRichChannelMessage", (params: any) =>
        executeSendRichChannelMessage(params, updateStatus)
      ),
    }),
    sendRichDirectMessage: tool({
      description:
        "Send a rich formatted direct message using Slack Block Kit to a user. Use this for complex layouts, buttons, images, and structured content.",
      parameters: z.object({
        userIdOrEmail: z
          .string()
          .describe("User ID or email address of the recipient"),
        blocks: slackBlockKitBlocks,
        text: z
          .string()
          .describe(
            "Fallback text for notifications (leave empty string if not needed)"
          ),
        postTimes: z
          .array(z.number())
          .describe(
            "Optional array of Unix seconds to schedule this DM multiple times (max 10). Provide empty array to send immediately."
          ),
      }),
      execute: executor("sendRichDirectMessage", (params: any) =>
        executeSendRichDirectMessage(params, updateStatus)
      ),
    }),
    createFormattedSlackMessage: tool({
      description:
        "Create a beautifully formatted Slack message with structured layout using Block Kit. Perfect for status updates, issue summaries, reports, and rich content.",
      parameters: z.object({
        channel: z
          .string()
          .describe("The channel ID or name to send the message to"),
        title: z
          .string()
          .describe(
            "Header title for the message (leave empty string if not needed)"
          ),
        content: z.string().describe("Main content text (supports markdown)"),
        fields: z
          .array(
            z.object({
              label: z.string().describe("Field label"),
              value: z.string().describe("Field value"),
            })
          )
          .describe(
            "Array of key-value fields to display (use empty array if not needed)"
          ),
        context: z
          .string()
          .describe(
            "Context text like timestamps or metadata (leave empty string if not needed)"
          ),
        actions: z
          .array(
            z.object({
              text: z.string().describe("Button text"),
              action_id: z.string().describe("Unique action identifier"),
              style: z.enum(["primary", "danger"]),
            })
          )
          .describe(
            "Array of action buttons (use empty array if not needed)"
          ),
        thread_ts: z
          .string()
          .describe(
            "Thread timestamp to reply in a thread (leave empty string if not replying to a thread)"
          ),
      }),
      execute: executor("createFormattedSlackMessage", (params: any) =>
        executeCreateFormattedSlackMessage(params, updateStatus)
      ),
    }),
    respondToSlackInteraction: tool({
      description:
        "Respond to a Slack interactive component (button click, etc.) using the response URL. Use this when responding to button clicks or other interactive elements.",
      parameters: z.object({
        responseUrl: z
          .string()
          .describe("The response URL provided by Slack for the interaction"),
        text: z
          .string()
          .describe(
            "Optional response text (leave empty string if not needed)"
          ),
        blocks: slackBlockKitBlocks.describe(
          "Optional Block Kit blocks for rich formatting (use empty array if not needed)"
        ),
        replaceOriginal: z
          .boolean()
          .describe(
            "Whether to replace the original message (true) or send a new message (false)"
          ),
        deleteOriginal: z
          .boolean()
          .describe("Whether to delete the original message"),
        responseType: z
          .enum(["ephemeral", "in_channel"])
          .describe(
            'Whether the response should be ephemeral (only visible to the user) or in_channel (visible to everyone). Use "ephemeral" if not specified.'
          ),
      }),
      execute: executor("respondToSlackInteraction", (params: any) =>
        executeRespondToSlackInteraction(params, updateStatus)
      ),
    }),
  };
}
