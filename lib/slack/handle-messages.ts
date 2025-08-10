import type {
  AssistantThreadStartedEvent,
  GenericMessageEvent,
} from "@slack/web-api";
import {
  client,
  getThread,
  sendMessage,
  updateStatusUtil,
  getLinearClientForSlack,
} from "./slack-utils.js";
import { generateResponse } from "../generate-response.js";
import {
  makeSlackContextId,
  startSlackSession,
  endSlackSession,
} from "./session-manager.js";

export async function assistantThreadMessage(
  event: AssistantThreadStartedEvent
) {
  const { channel_id, thread_ts } = event.assistant_thread;
  console.log(
    `[slack:assistantThreadMessage] Received event for ${channel_id}:${thread_ts}. Doing nothing to avoid duplicate replies.`
  );
  // Do not call generateResponse here. Let handleNewAssistantMessage handle it.
}

export async function handleNewAssistantMessage(
  event: GenericMessageEvent,
  botUserId: string
) {
  if (
    event.bot_id ||
    event.bot_id === botUserId ||
    event.bot_profile ||
    !event.thread_ts
  )
    return;

  const { channel, thread_ts } = event;
  console.log(
    `[slack:handleNewAssistantMessage] Received event for ${channel}:${thread_ts}. Proceeding to generate response.`
  );

  // Get LinearClient for this Slack context
  const linearClient = await getLinearClientForSlack();

  // Prepare Slack context for the AI
  const slackContext = {
    channelId: channel,
    threadTs: thread_ts,
  };

  const updateStatus = updateStatusUtil(channel, thread_ts);
  await updateStatus("is thinking...");

  const contextId = makeSlackContextId(channel, thread_ts);
  const abortController = startSlackSession(contextId);

  const messages = await getThread(channel, thread_ts, botUserId);

  try {
    await generateResponse(
      messages,
      updateStatus,
      linearClient,
      slackContext,
      abortController.signal
    );
  } finally {
    try {
      await updateStatus("");
    } catch {}
    endSlackSession(contextId, abortController);
  }
}

export async function handleNewAssistantMessage(
  event: GenericMessageEvent,
  botUserId: string
) {
  if (
    event.bot_id ||
    event.bot_id === botUserId ||
    event.bot_profile ||
    !event.thread_ts
  )
    return;

  const { channel, thread_ts } = event;

  // Get LinearClient for this Slack context
  const linearClient = await getLinearClientForSlack();

  // Prepare Slack context for the AI
  const slackContext = {
    channelId: channel,
    threadTs: thread_ts,
  };

  const updateStatus = updateStatusUtil(channel, thread_ts);
  await updateStatus("is thinking...");

  const contextId = makeSlackContextId(channel, thread_ts);
  const abortController = startSlackSession(contextId);

  const messages = await getThread(channel, thread_ts, botUserId);

  try {
    await generateResponse(
      messages,
      updateStatus,
      linearClient,
      slackContext,
      abortController.signal
    );
  } finally {
    try {
      await updateStatus("");
    } catch {}
    endSlackSession(contextId, abortController);
  }
}
