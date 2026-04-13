import { tool } from "ai";
import { z } from "zod";
import {
  executeGetFileContent,
  executeCreatePullRequest,
  executeGetPullRequest,
  executeAddPullRequestComment,
  executeGetPullRequestFiles,
  executeGetDirectoryStructure,
  executeCreateIssue as executeGithubCreateIssue,
  executeGetIssue as executeGithubGetIssue,
  executeListIssues as executeGithubListIssues,
  executeAddIssueComment as executeGithubAddIssueComment,
  executeUpdateIssue as executeGithubUpdateIssue,
  executeGetIssueComments as executeGithubGetIssueComments,
} from "../tool-executors.js";

type ToolExecutorWrapper = (
  name: string,
  fn: Function
) => (...args: any[]) => any;

export function createGithubTools(
  executor: ToolExecutorWrapper,
  updateStatus?: (status: string) => void
) {
  return {
    getFileContent: tool({
      description: "Get the content of a file from a GitHub repository",
      parameters: z.object({
        path: z.string().describe("The file path in the repository"),
        repository: z
          .string()
          .describe('The repository in format "owner/repo"'),
        startLine: z
          .number()
          .describe(
            "Starting line number (default: 1). Use 1 if not specified."
          ),
        maxLines: z
          .number()
          .describe(
            "Maximum number of lines to return (default: 200). Use 200 if not specified."
          ),
        branch: z
          .string()
          .describe(
            "Branch name (default: repository default branch). Leave empty to use default branch."
          ),
      }),
      execute: executor("getFileContent", (params: any) =>
        executeGetFileContent(params, updateStatus)
      ),
    }),

    createPullRequest: tool({
      description: "Create a pull request in a GitHub repository",
      parameters: z.object({
        title: z.string().describe("The title of the pull request"),
        body: z.string().describe("The body/description of the pull request"),
        head: z.string().describe("The branch containing the changes"),
        base: z.string().describe("The branch to merge into"),
        repository: z
          .string()
          .describe('The repository in format "owner/repo"'),
      }),
      execute: executor("createPullRequest", (params: any) =>
        executeCreatePullRequest(params, updateStatus)
      ),
    }),

    getPullRequest: tool({
      description: "Get details of a pull request including comments",
      parameters: z.object({
        repository: z
          .string()
          .describe('The repository in format "owner/repo"'),
        pullNumber: z.number().describe("The pull request number"),
      }),
      execute: executor("getPullRequest", (params: any) =>
        executeGetPullRequest(params, updateStatus)
      ),
    }),

    addPullRequestComment: tool({
      description: "Add a comment to a pull request",
      parameters: z.object({
        repository: z
          .string()
          .describe('The repository in format "owner/repo"'),
        pullNumber: z.number().describe("The pull request number"),
        body: z.string().describe("The comment text"),
      }),
      execute: executor("addPullRequestComment", (params: any) =>
        executeAddPullRequestComment(params, updateStatus)
      ),
    }),

    getPullRequestFiles: tool({
      description: "Get the files changed in a pull request",
      parameters: z.object({
        repository: z
          .string()
          .describe('The repository in format "owner/repo"'),
        pullNumber: z.number().describe("The pull request number"),
      }),
      execute: executor("getPullRequestFiles", (params: any) =>
        executeGetPullRequestFiles(params, updateStatus)
      ),
    }),

    githubCreateIssue: tool({
      description: "Create a GitHub issue",
      parameters: z.object({
        repository: z
          .string()
          .describe('The repository in format "owner/repo"'),
        title: z.string().describe("Issue title"),
        body: z.string().describe("Issue body/description"),
        labels: z
          .array(z.string())
          .describe("Labels to add (use empty array if none)"),
        assignees: z
          .array(z.string())
          .describe("Assignees (use empty array if none)"),
      }),
      execute: executor("githubCreateIssue", (params: any) =>
        executeGithubCreateIssue(params, updateStatus)
      ),
    }),

    githubGetIssue: tool({
      description: "Get a GitHub issue by number",
      parameters: z.object({
        repository: z
          .string()
          .describe('The repository in format "owner/repo"'),
        issueNumber: z.number().describe("Issue number"),
      }),
      execute: executor("githubGetIssue", (params: any) =>
        executeGithubGetIssue(params, updateStatus)
      ),
    }),

    githubListIssues: tool({
      description: "List GitHub issues for a repository with filters",
      parameters: z.object({
        repository: z
          .string()
          .describe('The repository in format "owner/repo"'),
        state: z
          .enum(["open", "closed", "all"])
          .describe("Issue state filter"),
        labels: z.string().describe("Comma-separated labels filter"),
        assignee: z.string().describe("Assignee username"),
        perPage: z
          .number()
          .describe("Results per page (<=100). Use 30 if not specified."),
      }),
      execute: executor("githubListIssues", (params: any) =>
        executeGithubListIssues(params, updateStatus)
      ),
    }),

    githubAddIssueComment: tool({
      description: "Add a comment to a GitHub issue",
      parameters: z.object({
        repository: z
          .string()
          .describe('The repository in format "owner/repo"'),
        issueNumber: z.number().describe("Issue number"),
        body: z.string().describe("Comment body text"),
      }),
      execute: executor("githubAddIssueComment", (params: any) =>
        executeGithubAddIssueComment(params, updateStatus)
      ),
    }),

    githubUpdateIssue: tool({
      description:
        "Update a GitHub issue (title, body, state, labels, assignees)",
      parameters: z.object({
        repository: z
          .string()
          .describe('The repository in format "owner/repo"'),
        issueNumber: z.number().describe("Issue number"),
        title: z
          .string()
          .describe("New title (leave empty string if unchanged)"),
        body: z
          .string()
          .describe("New body (leave empty string if unchanged)"),
        state: z.enum(["open", "closed"]).describe("New state"),
        labels: z
          .array(z.string())
          .describe("Labels to set (use empty array to leave unchanged)"),
        assignees: z
          .array(z.string())
          .describe("Assignees to set (use empty array to leave unchanged)"),
      }),
      execute: executor("githubUpdateIssue", (params: any) =>
        executeGithubUpdateIssue(params, updateStatus)
      ),
    }),

    githubGetIssueComments: tool({
      description: "List comments on a GitHub issue",
      parameters: z.object({
        repository: z
          .string()
          .describe('The repository in format "owner/repo"'),
        issueNumber: z.number().describe("Issue number"),
        perPage: z
          .number()
          .describe("Results per page (<=100). Use 30 if not specified."),
      }),
      execute: executor("githubGetIssueComments", (params: any) =>
        executeGithubGetIssueComments(params, updateStatus)
      ),
    }),

    getDirectoryStructure: tool({
      description: "Get the directory structure of a GitHub repository",
      parameters: z.object({
        repository: z
          .string()
          .describe('The repository in format "owner/repo"'),
        directoryPath: z
          .string()
          .describe(
            "Optional directory path (default: root directory). Leave empty for root directory."
          ),
      }),
      execute: executor("getDirectoryStructure", (params: any) =>
        executeGetDirectoryStructure(params, updateStatus)
      ),
    }),
  };
}
