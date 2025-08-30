import { CoreMessage } from "ai";
import { client, getLinearClientForSlack, getThread } from "./slack-utils.js";
import { generateResponse } from "../generate-response.js";
import {
  makeSlackContextId,
  startSlackSession,
  endSlackSession,
} from "./session-manager.js";

/**
 * Best-effort plain text extractor for Slack rich_text input values.
 * Falls back to JSON string if structure is unfamiliar.
 */
function extractPlainText(input: any): string {
  if (!input) return "";
  if (typeof input === "string") return input;

  try {
    // Handle Slack rich_text format
    if (input.type === "rich_text" && Array.isArray(input.elements)) {
      const flatten = (els: any[]): string =>
        els
          .map((el) => {
            if (!el) return "";
            if (typeof el === "string") return el;
            if (el.type === "text" && typeof el.text === "string")
              return el.text;
            if (el.type && Array.isArray(el.elements))
              return flatten(el.elements);
            if (Array.isArray(el.children)) return flatten(el.children);
            return typeof el.text === "string" ? el.text : "";
          })
          .join("");

      return flatten(input.elements).trim();
    }
  } catch {}

  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

/**
 * Create an update function that posts an initial status message and
 * then updates it as work progresses.
 */
async function createStatusUpdater(
  channel: string,
  thread_ts: string | undefined
) {
  const initial = await client.chat.postMessage({
    channel,
    thread_ts,
    text: "is thinking...",
  });

  const ts = (initial as any)?.ts as string | undefined;
  if (!ts) {
    // Fallback to a no-op updater
    return async (_: string) => {};
  }

  return async (status: string) => {
    await client.chat.update({ channel, ts, text: status || "" });
  };
}

/**
 * Handle Slack workflow `function_executed` events to "wake" Otron with context
 * provided by the workflow. We accept flexible payload shapes to be resilient
 * across Slack surfaces and UI builders.
 */
export async function handleFunctionExecuted(event: any, botUserId: string) {
  try {
    // Slack may provide inputs in several shapes; try them in order
    const inputs =
      event?.inputs ||
      event?.arguments ||
      event?.function_arguments ||
      event?.params ||
      {};

    // Channel resolution (ID or object)
    const channel: string | undefined =
      event?.channel ||
      event?.channel_id ||
      inputs?.channel?.id ||
      inputs?.channel ||
      inputs?.channel_id;

    // Optional thread to reply into
    const threadTs: string | undefined =
      event?.thread_ts ||
      event?.message_ts ||
      inputs?.thread_ts ||
      inputs?.message_ts;

    // Instruction / task
    const instructionRaw =
      inputs?.instruction ?? inputs?.prompt ?? inputs?.task;
    const instruction =
      extractPlainText(instructionRaw) ||
      "Run autonomously with available context.";

    // Human that initiated or is responsible (for context/mention)
    const human: string | undefined =
      inputs?.human?.id || inputs?.human || event?.user || event?.user_id;

    if (!channel) {
      console.warn("[function_executed] Missing channel; aborting");
      return;
    }

    // Ensure we have a thread to work in; if none provided, create one with a seed message
    let workingThreadTs = threadTs;
    if (!workingThreadTs) {
      const seed = await client.chat.postMessage({
        channel,
        text: `Otron workflow invoked${human ? ` by <@${human}>` : ""}.`,
      });
      workingThreadTs = (seed as any)?.ts;
    }

    // Compose an initial context message if we don't have thread history yet
    const contextLines: string[] = [];
    if (human) contextLines.push(`Requested by <@${human}>`);
    contextLines.push(`Instruction: ${instruction}`);
    if (event?.workflow || event?.workflow_id || event?.function_id) {
      const meta = {
        workflow: event?.workflow?.name || event?.workflow,
        workflow_id: event?.workflow_id,
        function_id: event?.function_id,
        event_context: event?.event_context,
      };
      contextLines.push(`Workflow context: ${JSON.stringify(meta)}`);
      contextLines.push(
        `\n\nYou have been invoked via a Slack Workflow. Run autonomously with available context and tag users as needed.`
      );
    }

    // Build messages either from thread or synthetic context
    let messages: CoreMessage[] = [];
    if (workingThreadTs) {
      try {
        messages = await getThread(channel, workingThreadTs, botUserId);
      } catch {}
    }
    if (messages.length === 0) {
      messages = [{ role: "user", content: contextLines.join("\n") }];
    } else {
      // Append the instruction as the latest user message for clarity
      messages.push({ role: "user", content: contextLines.join("\n") });
    }

    // Obtain Linear client if available for richer tools
    const linearClient = await getLinearClientForSlack();

    // Prepare context and status updater
    const slackContext = { channelId: channel, threadTs: workingThreadTs };
    const updateStatus = await createStatusUpdater(channel, workingThreadTs);

    const contextId = makeSlackContextId(channel, workingThreadTs || "");
    const abortController = startSlackSession(contextId);

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
  } catch (err) {
    console.error("Error handling function_executed event:", err);
  }
}
