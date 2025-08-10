import type {
  AssistantThreadStartedEvent,
  GenericMessageEvent,
} from "@slack/web-api";
import {
  client,
  getThread,
  updateStatusUtil,
  getLinearClientForSlack,
} from "./slack-utils.js";
import { generateResponse } from "../generate-response.js";
import {
  makeSlackContextId,
  startSlackSession,
  endSlackSession,
} from "./session-manager.js";
import { LinearClient } from "@linear/sdk";

const genericPrompts = [
  "Summarize what you can do for me here",
  "Draft a status update for my team from this thread",
  "Create a Linear issue from our plan",
  "Open a GitHub issue for this bug",
  "Search our codebase for <thing>",
  "Review PR #<number> and suggest changes",
  "Do a quick research scan on <topic> with sources",
];

export async function assistantThreadMessage(
  event: AssistantThreadStartedEvent
) {
  const { channel_id, thread_ts } = event.assistant_thread;
  console.log(`Thread started: ${channel_id} ${thread_ts}`);

  // Set up suggested prompts without sending an automatic greeting, only for DMs
  if (channel_id.startsWith("D")) {
    await client.assistant.threads.setSuggestedPrompts({
      channel_id: channel_id,
      thread_ts: thread_ts,
      prompts: genericPrompts.map((prompt) => ({
        title: prompt,
        message: prompt,
      })) as [
        { title: string; message: string },
        ...{ title: string; message: string }[]
      ],
    });
  }
}

export async function handleNewAssistantMessage(
  event: GenericMessageEvent,
  botUserId: string
) {
  if (
    event.subtype === "bot_message" ||
    !event.user ||
    event.user === botUserId
  ) {
    return;
  }

  if (!event.thread_ts) {
    // This is not a thread message, so we don't need to do anything else.
    return;
  }

  const { channel, thread_ts } = event;
  console.log(
    `[slack:handleNewAssistantMessage] Received event for ${channel}:${thread_ts}. Proceeding to generate response.`
  );

  // Get LinearClient for this Slack context
  let linearClient: LinearClient | undefined;
  try {
    linearClient = await getLinearClientForSlack();
  } catch (e) {
    console.error("[slack] handleNewAssistantMessage error:", e);
    linearClient = undefined;
    return;
  }

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
