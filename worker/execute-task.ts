import { query } from "@anthropic-ai/claude-agent-sdk";
import Anthropic from "@anthropic-ai/sdk";
import { workerEnv } from "./env.js";
import type { CodingTask } from "../lib/task-queue.js";

export interface TaskExecutionResult {
  status: "completed" | "failed";
  summary: string;
  error?: string;
  messagesProcessed: number;
}

/**
 * Activity callback for streaming progress to Linear/Slack.
 *
 * - thought: background processing info (tool calls, searching, reading)
 * - action: meaningful step taken (editing file, running command)
 * - response: final or significant output to show the user
 * - error: something went wrong
 */
export type ActivityCallback = (
  type: "thought" | "action" | "response" | "error",
  message: string
) => Promise<void>;

/**
 * Execute a coding task using the Claude Agent SDK.
 * Streams activity events via the onActivity callback so the caller
 * can forward them to Linear agent activity / Slack thread status.
 */
export async function executeCodingTask(
  task: CodingTask,
  repoPath: string,
  onActivity: ActivityCallback
): Promise<TaskExecutionResult> {
  const prompt = buildPrompt(task);
  let messagesProcessed = 0;
  let lastAssistantText = "";

  try {
    await onActivity("thought", `Starting Claude Code (${task.intent} mode)...`);

    const session = query({
      prompt,
      options: {
        allowedTools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
        permissionMode: "acceptEdits",
        cwd: repoPath,
        maxTurns: 50,
      },
    });

    for await (const message of session) {
      messagesProcessed++;

      switch (message.type) {
        case "assistant": {
          // Claude produced a response (may contain text and/or tool_use blocks)
          if (message.message?.content) {
            for (const block of message.message.content as any[]) {
              if (block.type === "text" && block.text) {
                lastAssistantText = block.text;
                // Stream meaningful text as thoughts
                const preview =
                  block.text.length > 300
                    ? block.text.substring(0, 300) + "..."
                    : block.text;
                await onActivity("thought", preview);
              } else if (block.type === "tool_use") {
                // Log tool invocations as actions
                const inputPreview = block.input
                  ? JSON.stringify(block.input).substring(0, 150)
                  : "";
                await onActivity(
                  "action",
                  `${block.name}: ${inputPreview}`
                );
              }
            }
          }
          break;
        }

        case "tool_use_summary": {
          // Compact summary of tool operations (good for activity feed)
          await onActivity("thought", message.summary);
          break;
        }

        case "result": {
          // Final result
          if ("result" in message && message.result) {
            lastAssistantText = message.result;
          }
          if (message.is_error) {
            const errors = "errors" in message ? (message.errors as string[]) : [];
            await onActivity("error", errors.join("; ") || "Task ended with error");
          }
          break;
        }
      }
    }

    await onActivity("response", "Claude Code completed.");

    // Summarize the raw output using an LLM for a concise, platform-appropriate response
    const summary = await summarizeOutput(lastAssistantText, task);

    return {
      status: "completed",
      summary: summary || "Task completed (no output)",
      messagesProcessed,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    await onActivity("error", errMsg);

    // Still try to summarize whatever output we got before the error
    const summary = lastAssistantText
      ? await summarizeOutput(lastAssistantText, task)
      : "Task failed before producing output";

    return {
      status: "failed",
      summary,
      error: errMsg,
      messagesProcessed,
    };
  }
}

/**
 * Summarize raw Claude Code output into a concise, platform-appropriate response
 * that directly answers the original question or describes the work done.
 */
async function summarizeOutput(
  rawOutput: string,
  task: CodingTask
): Promise<string> {
  if (!rawOutput) return rawOutput;
  if (!workerEnv.ANTHROPIC_API_KEY) {
    console.warn("No ANTHROPIC_API_KEY — skipping summarization");
    return rawOutput;
  }

  const intentGuidance: Record<string, string> = {
    research:
      "Produce a clear, concise answer to the original question. Focus on directly answering what was asked, using specific details from the agent's findings.",
    work:
      "Produce a brief summary of what was done. Mention key changes made, files modified, branches created, and any PRs opened.",
    review:
      "Produce a structured review summary with key findings, issues discovered, and actionable recommendations.",
  };

  const guidance =
    intentGuidance[task.intent] || intentGuidance.work;

  const maxChars = task.source === "slack" ? 2000 : 4000;

  try {
    const client = new Anthropic({ apiKey: workerEnv.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `You are summarizing the output of a coding agent. ${guidance}

Original task prompt:
${task.prompt.substring(0, 2000)}

Raw agent output:
${rawOutput.substring(0, 8000)}

Produce a concise summary (max ${maxChars} characters) that directly addresses the original request. Do not include meta-commentary about summarizing — just provide the answer or summary directly.`,
        },
      ],
    });

    const text =
      response.content[0]?.type === "text"
        ? response.content[0].text
        : rawOutput;

    return text.substring(0, maxChars);
  } catch (err) {
    console.error("Summarization failed, using raw output:", err);
    return rawOutput.substring(0, maxChars);
  }
}

function buildPrompt(task: CodingTask): string {
  const parts: string[] = [];

  switch (task.intent) {
    case "work":
      parts.push(
        "You are working on a coding task. Implement the requested changes, commit to a new branch, and push."
      );
      break;
    case "review":
      parts.push(
        "You are reviewing code. Analyze the code thoroughly and provide detailed feedback. Do not make changes."
      );
      break;
    case "research":
      parts.push(
        "You are researching a technical question. Explore the codebase and provide a detailed answer."
      );
      break;
    default:
      parts.push(
        "Analyze the request and take appropriate action. If it requires code changes, create a branch and commit."
      );
  }

  if (task.linearIssueIdentifier) {
    parts.push(`\nLinear Issue: ${task.linearIssueIdentifier}`);
  }

  parts.push(`\n## User Request\n${task.prompt}`);

  if (task.context) {
    parts.push(`\n## Additional Context\n${task.context}`);
  }

  if (task.intent === "work" && task.linearIssueIdentifier) {
    parts.push(
      `\nWhen creating a branch, use the format: feat/${task.linearIssueIdentifier.toLowerCase()}-<short-description>`
    );
  }

  return parts.join("\n");
}
