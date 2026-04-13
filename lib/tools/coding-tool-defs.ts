import { tool } from "ai";
import { z } from "zod";
import { enqueueCodingTask } from "../task-queue.js";

type ToolExecutorWrapper = (
  name: string,
  fn: Function
) => (...args: any[]) => any;

export function createCodingTools(
  executor: ToolExecutorWrapper,
  context?: {
    slackChannelId?: string;
    slackThreadTs?: string;
    linearSessionId?: string;
    linearIssueId?: string;
    linearIssueIdentifier?: string;
  },
  onCodingTaskDispatched?: () => void
) {
  return {
    dispatchCodingTask: tool({
      description:
        "Dispatch a coding task to the Claude Code worker. Use this when you need to implement code changes, fix bugs, refactor code, write tests, review PRs, or do any work that requires reading/editing files in a repository. The worker runs Claude Code locally with full filesystem and git access. Results will be reported back to the current conversation.",
      parameters: z.object({
        repository: z
          .string()
          .describe(
            'The repository to work in, format "owner/repo" (e.g., "otron-io/otron")'
          ),
        prompt: z
          .string()
          .describe(
            "Detailed description of what the coding task should accomplish. Be specific about what files to change, what behavior to implement, etc."
          ),
        intent: z
          .enum(["work", "review", "research"])
          .describe(
            '"work" = implement/fix code and commit, "review" = analyze code and provide feedback without changes, "research" = explore codebase and answer questions'
          ),
        baseBranch: z
          .string()
          .describe(
            'The branch to base work on (default: "main"). Leave empty for default.'
          ),
        context: z
          .string()
          .describe(
            "Any additional context to pass to the coding agent (issue descriptions, error logs, etc.). Leave empty if not needed."
          ),
      }),
      execute: executor(
        "dispatchCodingTask",
        async (params: {
          repository: string;
          prompt: string;
          intent: "work" | "review" | "research";
          baseBranch: string;
          context: string;
        }) => {
          const taskId = crypto.randomUUID();

          await enqueueCodingTask({
            id: taskId,
            createdAt: Date.now(),
            source: context?.slackChannelId
              ? "slack"
              : context?.linearSessionId
              ? "linear"
              : "github",
            linearSessionId: context?.linearSessionId,
            linearIssueId: context?.linearIssueId,
            linearIssueIdentifier: context?.linearIssueIdentifier,
            slackChannelId: context?.slackChannelId,
            slackThreadTs: context?.slackThreadTs,
            repository: params.repository,
            baseBranch: params.baseBranch || undefined,
            prompt: params.prompt,
            context: params.context || "",
            intent: params.intent,
          });

          // Signal that the Linear session should stay open for the worker
          onCodingTaskDispatched?.();

          return `Coding task dispatched (task ID: ${taskId}). The Claude Code worker will pick it up, execute in the ${params.repository} repository, and report results back here.`;
        }
      ),
    }),
  };
}
