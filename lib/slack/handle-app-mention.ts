import type { AppMentionEvent } from "@slack/web-api";
import { client, getThread, getLinearClientForSlack } from "./slack-utils.js";
import { generateResponse } from "../generate-response.js";
import {
  makeSlackContextId,
  startSlackSession,
  endSlackSession,
} from "./session-manager.js";

const updateStatusUtil = async (
  initialStatus: string,
  event: AppMentionEvent
) => {
  const initialMessage = await client.chat.postMessage({
    channel: event.channel,
    thread_ts: event.thread_ts ?? event.ts,
    text: initialStatus,
  });

  if (!initialMessage || !initialMessage.ts)
    throw new Error("Failed to post initial message");

  const updateMessage = async (status: string) => {
    await client.chat.update({
      channel: event.channel,
      ts: initialMessage.ts as string,
      text: status,
    });
  };
  return updateMessage;
};

export async function handleNewAppMention(
  event: AppMentionEvent,
  botUserId: string
) {
  if (event.bot_id || event.bot_id === botUserId || event.bot_profile) return;

  const { channel, thread_ts } = event;

  // Get LinearClient for this Slack context
  const linearClient = await getLinearClientForSlack();

  // Prepare Slack context for the AI
  const slackContext = {
    channelId: channel,
    threadTs: thread_ts || event.ts,
  };

  const updateMessage = async (status: string) => {
    await client.assistant.threads.setStatus({
      channel_id: channel,
      thread_ts: thread_ts || event.ts,
      status: status,
    });
  };

  const contextId = makeSlackContextId(channel, thread_ts || event.ts);
  const abortController = startSlackSession(contextId);

  try {
    if (thread_ts) {
      const messages = await getThread(channel, thread_ts, botUserId);
      await generateResponse(
        messages,
        updateMessage,
        linearClient,
        slackContext,
        abortController.signal
      );
    } else {
      const currentMessageContext = `[Message from user ${event.user} at ${
        event.ts
      }]: ${event.text.replace(`<@${botUserId}> `, "")}`;
      await generateResponse(
        [{ role: "user", content: currentMessageContext }],
        updateMessage,
        linearClient,
        slackContext,
        abortController.signal
      );
    }
  } finally {
    try {
      await updateMessage("");
    } catch {}
    endSlackSession(contextId, abortController);
  }
}
