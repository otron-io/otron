import * as githubUtils from "./github/github-utils.js";
import { agentActivity } from "./linear/linear-agent-session-manager.js";

// Helper function to extract Linear issue ID from branch name or context
export const extractLinearIssueFromBranch = (
  branchName: string
): string | null => {
  // Look for Linear issue patterns like OTR-123, ABC-456, etc. in branch names
  const issueMatch = branchName.match(/\b([A-Z]{2,}-\d+)\b/);
  return issueMatch ? issueMatch[1] : null;
};

// GitHub tool execution functions
export const executeGetFileContent = async (
  {
    file_path,
    repository,
    startLine,
    maxLines,
    branch,
  }: {
    file_path: string;
    repository: string;
    startLine: number;
    maxLines: number;
    branch: string;
  },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is getting content for ${file_path}...`);

  const content = await githubUtils.getFileContent(
    file_path,
    repository,
    startLine === 0 ? undefined : startLine,
    maxLines === 0 ? undefined : maxLines,
    branch || undefined,
    undefined
  );
  return { content };
};

export const executeCreatePullRequest = async (
  {
    title,
    body,
    head,
    base,
    repository,
  }: {
    title: string;
    body: string;
    head: string;
    base: string;
    repository: string;
  },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is creating pull request "${title}" in ${repository}...`);

  // Extract Linear issue ID and add strategic thinking
  const issueId = extractLinearIssueFromBranch(head);
  if (issueId) {
    await agentActivity.thought(
      issueId,
      `🔄 Pull request strategy: Creating PR to merge '${head}' → '${base}' in ${repository}. Title: "${title}". Body length: ${body.length} chars.`
    );
    await agentActivity.thought(
      issueId,
      `📝 PR content preview: "${body.substring(0, 150)}${
        body.length > 150 ? "..." : ""
      }"`
    );
  }

  const result = await githubUtils.createPullRequest(
    title,
    body,
    head,
    base,
    repository
  );

  if (issueId) {
    await agentActivity.action(
      issueId,
      "Created pull request",
      `#${result.number}: ${title}`,
      `PR ready for review at ${result.url}`
    );
  }

  return {
    success: true,
    url: result.url,
    number: result.number,
    message: `Created pull request #${result.number}: ${title}`,
  };
};

export const executeGetPullRequest = async (
  { repository, pullNumber }: { repository: string; pullNumber: number },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(
    `is getting details for PR #${pullNumber} in ${repository}...`
  );

  const pullRequest = await githubUtils.getPullRequest(repository, pullNumber);
  return { pullRequest };
};

export const executeAddPullRequestComment = async (
  {
    repository,
    pullNumber,
    body,
  }: { repository: string; pullNumber: number; body: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is adding comment to PR #${pullNumber} in ${repository}...`);

  const result = await githubUtils.addPullRequestComment(
    repository,
    pullNumber,
    body
  );
  return {
    success: true,
    commentId: result.id,
    url: result.url,
    message: `Added comment to PR #${pullNumber}`,
  };
};

export const executeGetPullRequestFiles = async (
  { repository, pullNumber }: { repository: string; pullNumber: number },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is getting files for PR #${pullNumber} in ${repository}...`);

  const files = await githubUtils.getPullRequestFiles(repository, pullNumber);
  return { files };
};

// GitHub Issue executors (ported from marvin-slack)
export const executeCreateIssue = async (
  {
    repository,
    title,
    body,
    labels,
    assignees,
  }: {
    repository: string;
    title: string;
    body: string;
    labels: string[];
    assignees: string[];
  },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is creating issue "${title}" in ${repository}...`);
  const result = await githubUtils.createIssue(
    repository,
    title,
    body || undefined,
    labels?.length ? labels : undefined,
    assignees?.length ? assignees : undefined
  );
  return {
    success: true,
    url: result.url,
    number: result.number,
    message: `Created issue #${result.number}: ${title}`,
  };
};

export const executeGetIssue = async (
  { repository, issueNumber }: { repository: string; issueNumber: number },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is getting issue #${issueNumber} in ${repository}...`);
  const issue = await githubUtils.getIssue(repository, issueNumber);
  return { issue };
};

export const executeListIssues = async (
  {
    repository,
    state,
    labels,
    assignee,
    perPage,
  }: {
    repository: string;
    state: "open" | "closed" | "all";
    labels: string;
    assignee: string;
    perPage: number;
  },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is listing issues in ${repository}...`);
  const issues = await githubUtils.listIssues(repository, {
    state: state || undefined,
    labels: labels || undefined,
    assignee: assignee || undefined,
    perPage: perPage || undefined,
  });
  return { issues };
};

export const executeAddIssueComment = async (
  {
    repository,
    issueNumber,
    body,
  }: { repository: string; issueNumber: number; body: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(
    `is adding comment to issue #${issueNumber} in ${repository}...`
  );
  const result = await githubUtils.addIssueComment(
    repository,
    issueNumber,
    body
  );
  return {
    success: true,
    commentId: result.id,
    url: result.url,
    message: `Added comment to issue #${issueNumber}`,
  };
};

export const executeUpdateIssue = async (
  {
    repository,
    issueNumber,
    title,
    body,
    state,
    labels,
    assignees,
  }: {
    repository: string;
    issueNumber: number;
    title: string;
    body: string;
    state: "open" | "closed";
    labels: string[];
    assignees: string[];
  },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is updating issue #${issueNumber} in ${repository}...`);
  const result = await githubUtils.updateIssue(repository, issueNumber, {
    title: title || undefined,
    body: body || undefined,
    state: state || undefined,
    labels: labels?.length ? labels : undefined,
    assignees: assignees?.length ? assignees : undefined,
  });
  return {
    success: true,
    url: result.url,
    number: result.number,
    state: result.state,
    message: `Updated issue #${result.number}`,
  };
};

export const executeGetIssueComments = async (
  {
    repository,
    issueNumber,
    perPage,
  }: {
    repository: string;
    issueNumber: number;
    perPage: number;
  },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(
    `is listing comments for issue #${issueNumber} in ${repository}...`
  );
  const comments = await githubUtils.listIssueComments(
    repository,
    issueNumber,
    {
      perPage: perPage || undefined,
    }
  );
  return { comments };
};

export const executeGetDirectoryStructure = async (
  { repository, directoryPath }: { repository: string; directoryPath: string },
  updateStatus?: (status: string) => void
) => {
  try {
    updateStatus?.(
      `is getting directory structure for ${
        directoryPath || "root"
      } in ${repository}...`
    );

    const structure = await githubUtils.getDirectoryStructure(
      repository,
      directoryPath || ""
    );
    return {
      success: true,
      structure,
      message: `Retrieved directory structure for ${
        directoryPath || "root"
      } in ${repository}`,
    };
  } catch (error) {
    console.error(
      `Error getting directory structure for ${
        directoryPath || "root"
      } in ${repository}:`,
      error
    );

    // Handle specific error cases
    if (error instanceof Error && "status" in error) {
      const httpError = error as any;
      if (httpError.status === 404) {
        return {
          success: false,
          structure: [
            {
              name: `Directory not found: ${directoryPath || "root"}`,
              file_path: directoryPath || "",
              type: "file" as const,
            },
          ],
          message: `Directory "${
            directoryPath || "root"
          }" not found in repository ${repository}. This directory may not exist or you may not have access to it.`,
        };
      }
    }

    return {
      success: false,
      structure: [
        {
          name: "Error retrieving directory structure",
          file_path: directoryPath || "",
          type: "file" as const,
        },
      ],
      message: `Failed to get directory structure: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    };
  }
};
