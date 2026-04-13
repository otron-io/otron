import { WebClient } from "@slack/web-api";
import { LinearClient } from "@linear/sdk";
import { workerEnv } from "./env.js";
import { getLinearAccessToken } from "./linear-auth.js";
import * as linearActivity from "./linear-activity.js";
import type { CodingTask, CodingTaskResult } from "../lib/task-queue.js";
import type { ActivityCallback } from "./execute-task.js";

let slackClient: WebClient | undefined;

function getSlackClient(): WebClient | undefined {
  if (!workerEnv.SLACK_BOT_TOKEN) return undefined;
  if (!slackClient) slackClient = new WebClient(workerEnv.SLACK_BOT_TOKEN);
  return slackClient;
}

async function getLinearClient(): Promise<LinearClient | undefined> {
  const token = await getLinearAccessToken();
  if (!token) return undefined;
  return new LinearClient({ accessToken: token });
}

/**
 * Build an ActivityCallback that streams Claude Code progress to
 * Linear agent activity and/or Slack thread status in real time.
 */
export function createActivityReporter(task: CodingTask): ActivityCallback {
  // Throttle: don't spam the APIs with every single event
  let lastLinearActivity = 0;
  let lastSlackStatus = 0;
  const LINEAR_THROTTLE_MS = 2000;
  const SLACK_THROTTLE_MS = 2000;

  return async (type, message) => {
    const now = Date.now();

    // --- Linear: post agent activity on the open session ---
    if (task.source === "linear" && task.linearSessionId) {
      if (now - lastLinearActivity > LINEAR_THROTTLE_MS || type === "response" || type === "error") {
        lastLinearActivity = now;
        try {
          switch (type) {
            case "thought":
              await linearActivity.emitThought(task.linearSessionId, message);
              break;
            case "action": {
              // Parse "toolName: details" format
              const colonIdx = message.indexOf(":");
              if (colonIdx > 0) {
                const action = message.substring(0, colonIdx).trim();
                const parameter = message.substring(colonIdx + 1).trim();
                await linearActivity.emitAction(task.linearSessionId, action, parameter);
              } else {
                await linearActivity.emitAction(task.linearSessionId, message, "");
              }
              break;
            }
            case "response":
              await linearActivity.emitResponse(task.linearSessionId, message);
              break;
            case "error":
              await linearActivity.emitError(task.linearSessionId, message);
              break;
          }
        } catch (err) {
          console.error("Failed to post Linear activity:", err);
        }
      }
    }

    // --- Slack: update thread status + post important messages ---
    if (task.source === "slack" && task.slackChannelId) {
      const slack = getSlackClient();
      if (slack) {
        try {
          if (
            (type === "thought" || type === "action") &&
            now - lastSlackStatus > SLACK_THROTTLE_MS
          ) {
            lastSlackStatus = now;
            await slack.assistant.threads.setStatus({
              channel_id: task.slackChannelId,
              thread_ts: task.slackThreadTs || "",
              status: message.substring(0, 150),
            });
          } else if (type === "response" || type === "error") {
            await slack.assistant.threads.setStatus({
              channel_id: task.slackChannelId,
              thread_ts: task.slackThreadTs || "",
              status: "",
            });
          }
        } catch (err) {
          console.error("Failed to update Slack status:", err);
        }
      }
    }

    // Always log to console
    console.log(
      `[${task.linearIssueIdentifier || task.slackChannelId || "task"}] ${type}: ${message.substring(0, 200)}`
    );
  };
}

/**
 * Report final task result back to the originating platform.
 */
export async function reportResult(
  task: CodingTask,
  result: CodingTaskResult
): Promise<void> {
  if (task.source === "linear") {
    await reportToLinear(task, result);
  } else if (task.source === "slack") {
    await reportToSlack(task, result);
  }
}

async function reportToLinear(
  task: CodingTask,
  result: CodingTaskResult
): Promise<void> {
  // Post final result as a response activity on the session (not a comment)
  if (task.linearSessionId) {
    try {
      const statusEmoji = result.status === "completed" ? "✅" : "❌";
      let body = `${statusEmoji} **Claude Code Result**\n\n${result.summary}`;
      if (result.prUrl) body += `\n\n**PR:** ${result.prUrl}`;
      if (result.branchName) body += `\n**Branch:** \`${result.branchName}\``;
      if (result.error) body += `\n\n**Error:** ${result.error}`;
      body += `\n\n_Duration: ${Math.round(result.duration / 1000)}s_`;

      // Linear can handle longer content — truncate at 4000 chars for readability
      if (body.length > 4000) {
        body = body.substring(0, 3950) + "\n\n_(output truncated)_";
      }

      await linearActivity.emitResponse(task.linearSessionId, body);

      // Complete the session — this signals Linear that the agent is done
      await linearActivity.completeSession(task.linearSessionId);

      console.log(`Completed Linear session ${task.linearSessionId}`);
    } catch (err) {
      console.error("Failed to complete Linear session:", err);
    }
  }

  // Fallback: also post as a comment if we have the issue identifier
  const linear = await getLinearClient();
  if (linear && task.linearIssueIdentifier) {
    try {
      const issue = await linear.issue(task.linearIssueIdentifier);
      if (issue) {
        const statusEmoji = result.status === "completed" ? "✅" : "❌";
        let body = `${statusEmoji} **Claude Code Worker Result**\n\n${result.summary}`;
        if (result.prUrl) body += `\n\n**PR:** ${result.prUrl}`;
        if (result.branchName) body += `\n**Branch:** \`${result.branchName}\``;
        if (result.error) body += `\n\n**Error:** ${result.error}`;
        body += `\n\n_Duration: ${Math.round(result.duration / 1000)}s_`;

        await linear.createComment({ issueId: issue.id, body });
      }
    } catch (err) {
      console.error("Failed to post Linear comment:", err);
    }
  }
}

async function reportToSlack(
  task: CodingTask,
  result: CodingTaskResult
): Promise<void> {
  const slack = getSlackClient();
  if (!slack || !task.slackChannelId) return;

  try {
    const statusEmoji =
      result.status === "completed" ? ":white_check_mark:" : ":x:";

    // For Slack, keep the summary concise — it's already been summarized
    // by the LLM step, but enforce a hard limit for readability
    let summary = result.summary;
    if (summary.length > 1800) {
      summary = summary.substring(0, 1750) + "\n\n_(output truncated)_";
    }

    let text = `${statusEmoji} *Claude Code Result*\n\n${summary}`;

    if (result.prUrl) text += `\n\n*PR:* ${result.prUrl}`;
    if (result.branchName) text += `\n*Branch:* \`${result.branchName}\``;
    if (result.error) text += `\n\n*Error:* ${result.error}`;
    text += `\n\n_Duration: ${Math.round(result.duration / 1000)}s_`;

    await slack.chat.postMessage({
      channel: task.slackChannelId,
      thread_ts: task.slackThreadTs,
      text,
    });
  } catch (err) {
    console.error("Failed to report to Slack:", err);
  }
}
