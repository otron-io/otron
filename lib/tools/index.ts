import { LinearClient } from "@linear/sdk";
import { createExaTools } from "./exa-tool-defs.js";
import { createSlackTools } from "./slack-tool-defs.js";
import { createLinearTools } from "./linear-tool-defs.js";
import { createGithubTools } from "./github-tool-defs.js";
import { createUtilityTools } from "./utility-tool-defs.js";
import { createCodingTools } from "./coding-tool-defs.js";
import { createCancelCodingTaskTool } from "./cancel-coding-task.js";

type ToolExecutorWrapper = (name: string, fn: Function) => (...args: any[]) => any;

export function createAllTools(options: {
  executor: ToolExecutorWrapper;
  updateStatus?: (status: string) => void;
  linearClient?: LinearClient;
  sleepWithAbort: (seconds: number, abort?: AbortSignal) => Promise<string>;
  codingContext?: {
    slackChannelId?: string;
    slackThreadTs?: string;
    linearSessionId?: string;
    linearIssueId?: string;
    linearIssueIdentifier?: string;
  };
  onCodingTaskDispatched?: () => void;
}) {
  const { executor, updateStatus, linearClient, sleepWithAbort, codingContext, onCodingTaskDispatched } = options;

  return {
    ...createExaTools(executor, updateStatus),
    ...createSlackTools(executor, updateStatus),
    ...createLinearTools(executor, updateStatus, linearClient),
    ...createGithubTools(executor, updateStatus),
    ...createUtilityTools(executor, sleepWithAbort),
    ...createCodingTools(executor, codingContext, onCodingTaskDispatched),
    ...createCancelCodingTaskTool(executor),
  };
}
