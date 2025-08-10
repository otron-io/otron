import * as githubUtils from "./github/github-utils.js";
import { advancedFileReader } from "./github/file-reader.js";
import { env } from "./env.js";
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

export const executeCreateBranch = async (
  {
    branch,
    repository,
    baseBranch,
  }: { branch: string; repository: string; baseBranch: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is creating branch ${branch}...`);

  // Extract Linear issue ID and add strategic thinking
  const issueId = extractLinearIssueFromBranch(branch);
  if (issueId) {
    await agentActivity.thought(
      issueId,
      `🌿 Branch strategy: Creating '${branch}' from '${
        baseBranch || "default"
      }' in ${repository}. This will be our working branch for implementing changes.`
    );
  }

  await githubUtils.createBranch(branch, repository, baseBranch || undefined);

  if (issueId) {
    await agentActivity.action(
      issueId,
      "Created branch",
      `${branch} from ${baseBranch || "default"}`,
      `Branch ready for development in ${repository}`
    );
  }

  return {
    success: true,
    message: `Created branch ${branch}`,
  };
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

export const executeSearchCode = async (
  {
    query,
    repository,
    fileFilter,
    maxResults,
  }: {
    query: string;
    repository: string;
    fileFilter: string;
    maxResults: number;
  },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is searching for code: "${query}"...`);

  const results = await githubUtils.searchCode(query, repository, {
    fileFilter: fileFilter || undefined,
    maxResults: maxResults === 0 ? undefined : maxResults,
  });
  return { results };
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

export const executeSearchEmbeddedCode = async (
  {
    repository,
    query,
    fileFilter,
    maxResults,
  }: {
    repository: string;
    query: string;
    fileFilter?: string;
    maxResults: number;
  },
  updateStatus?: (status: string) => void
) => {
  // Add very visible logging to confirm function is called
  console.log("🚨🚨🚨 executeSearchEmbeddedCode CALLED 🚨🚨🚨");
  console.log("Parameters received:", {
    repository,
    query,
    fileFilter,
    maxResults,
  });

  try {
    updateStatus?.("is searching embedded code...");

    // Extract Linear issue ID and add strategic thinking
    const issueId = extractLinearIssueFromBranch("current"); // Use current context
    if (issueId) {
      await agentActivity.thought(
        issueId,
        `🔍 Code search strategy: Searching ${repository} for "${query}"${
          fileFilter ? ` in files matching: ${fileFilter}` : ""
        }. Max results: ${maxResults}. This will help understand the codebase structure and locate relevant code.`
      );
    }

    // Use the same direct approach as embed-ui
    const searchParams = new URLSearchParams({
      repository,
      query,
      method: "vector",
      limit: ((maxResults <= 10 ? maxResults : 10) || 10).toString(),
    });

    if (fileFilter) {
      searchParams.append("fileFilter", fileFilter);
    }

    // Add detailed logging
    console.log("🔍 Code Search Debug Info:");
    console.log("  Repository:", repository);
    console.log("  Query:", query);
    console.log("  FileFilter:", fileFilter);
    console.log("  MaxResults:", maxResults);
    console.log("  SearchParams:", searchParams.toString());
    console.log("  INTERNAL_API_TOKEN exists:", !!env.INTERNAL_API_TOKEN);

    // Use absolute URL directly since relative URLs don't work in server environment
    const baseUrl = process.env.OTRON_URL || "http://localhost:3000";
    const absoluteUrl = baseUrl.startsWith("http")
      ? `${baseUrl}/api/code-search?${searchParams}`
      : `https://${baseUrl}/api/code-search?${searchParams}`;

    console.log("  Using absolute URL:", absoluteUrl);

    let response: Response;
    let debugInfo = "";

    // Make the API call directly with absolute URL
    response = await fetch(absoluteUrl, {
      method: "GET",
      headers: {
        "X-Internal-Token": env.INTERNAL_API_TOKEN,
        "Content-Type": "application/json",
      },
    });

    debugInfo += `URL used: ${absoluteUrl}\n`;
    debugInfo += `Response status: ${response.status}\n`;
    debugInfo += `Response ok: ${response.ok}\n`;

    console.log("  Response status:", response.status);
    console.log("  Response ok:", response.ok);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      debugInfo += `Error data: ${JSON.stringify(errorData)}\n`;
      console.log("  Error data:", errorData);
      throw new Error(
        `Code search API error: ${response.status} - ${
          errorData.error || response.statusText
        }`
      );
    }

    const data = await response.json();
    console.log("  Response data:", JSON.stringify(data, null, 2));

    // Format results for better readability
    const formattedResults =
      data.results?.map((result: any, index: number) => {
        const filePath = result.path || "Unknown file";
        const score = result.score ? (result.score * 100).toFixed(1) : "N/A";
        const type = result.type || "code";
        const name = result.name || "Unknown";

        // Truncate content to first 150 characters for readability
        let content = result.content || "";
        const lines = content.split("\n");
        const truncatedContent =
          lines.length > 3 ? lines.slice(0, 3).join("\n") + "\n..." : content;

        if (truncatedContent.length > 200) {
          content = truncatedContent.substring(0, 200) + "...";
        } else {
          content = truncatedContent;
        }

        return `**${index + 1}. ${filePath}** (${score}% match)
${type === "method" ? "🔧" : type === "class" ? "📦" : "📄"} ${name}
\`\`\`${result.language || "text"}
${content}
\`\`\``;
      }) || [];

    const summary =
      formattedResults.length > 0
        ? `## 🔍 Code Search Results for "${query}"
**Repository:** ${repository}
**Found:** ${data.results.length} matches

${formattedResults.join("\n\n---\n\n")}`
        : `## 🔍 No code matches found for "${query}" in ${repository}`;

    return {
      success: true,
      results: data.results, // Keep raw results for any further processing
      message: summary,
    };
  } catch (error) {
    console.error("Error searching embedded code:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
      message: `Code search failed: ${
        error instanceof Error ? error.message : "Unknown error occurred"
      }`,
    };
  }
};

export const executeGetRepositoryStructure = async (
  { repository, file_path }: { repository: string; file_path?: string },
  updateStatus?: (status: string) => void
) => {
  try {
    updateStatus?.("Getting repository structure...");

    // Use the direct GitHub utils approach
    const structure = await githubUtils.getDirectoryStructure(
      repository,
      file_path || ""
    );

    return {
      success: true,
      structure: structure,
      message: `Retrieved structure for ${repository}${
        file_path ? ` at file_path ${file_path}` : ""
      }`,
    };
  } catch (error) {
    console.error("Error getting repository structure:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
};

// 🚨 ULTRA-SAFE URL EDITING TOOL FOR DOCUMENTATION
export const executeEditUrl = async (
  {
    file_path,
    repository,
    branch,
    oldUrl,
    newUrl,
    message,
  }: {
    file_path: string;
    repository: string;
    branch: string;
    oldUrl: string;
    newUrl: string;
    message: string;
  },
  updateStatus?: (status: string) => void
) => {
  console.log("🔧 executeEditUrl CALLED");
  console.log("Parameters:", {
    file_path,
    repository,
    branch,
    oldUrlLength: oldUrl.length,
    newUrlLength: newUrl.length,
    message,
  });

  try {
    updateStatus?.(`is editing URL in ${file_path}...`);

    // 🚨 ULTRA-STRICT SAFETY CHECKS FOR URL EDITING

    // 1. Only allow URL-like content
    if (!oldUrl.includes("http://") && !oldUrl.includes("https://")) {
      throw new Error(
        `SAFETY CHECK FAILED: oldUrl must contain http:// or https:// to be recognized as a URL. Got: ${oldUrl.substring(
          0,
          100
        )}...`
      );
    }

    if (!newUrl.includes("http://") && !newUrl.includes("https://")) {
      throw new Error(
        `SAFETY CHECK FAILED: newUrl must contain http:// or https:// to be recognized as a URL. Got: ${newUrl.substring(
          0,
          100
        )}...`
      );
    }

    // 2. Prevent large URL blocks (should be single line URLs)
    if (oldUrl.length > 2000) {
      throw new Error(
        `SAFETY CHECK FAILED: oldUrl is too large (${oldUrl.length} characters). URLs should typically be under 2000 characters.`
      );
    }

    if (newUrl.length > 2000) {
      throw new Error(
        `SAFETY CHECK FAILED: newUrl is too large (${newUrl.length} characters). URLs should typically be under 2000 characters.`
      );
    }

    // 3. Prevent multi-line URLs (which might indicate accidental large matches)
    const oldUrlLines = oldUrl.split("\n").length;
    if (oldUrlLines > 3) {
      throw new Error(
        `SAFETY CHECK FAILED: oldUrl contains ${oldUrlLines} lines. For safety, URL edits should be 1-3 lines maximum.`
      );
    }

    // Get the current file content
    const { getFileContent } = await import("./github/github-utils.js");
    const currentContent = await getFileContent(
      file_path,
      repository,
      1,
      10000,
      branch,
      undefined
    );

    // Remove any header line that getFileContent might add
    const lines = currentContent.split("\n");
    let content = currentContent;
    if (lines.length > 0 && lines[0]?.match(/^\/\/ Lines \d+-\d+ of \d+$/)) {
      content = lines.slice(1).join("\n");
    }

    // Check if the old URL exists in the file
    if (!content.includes(oldUrl)) {
      throw new Error(
        `Old URL not found in ${file_path}. The file content may have changed since you last read it. Looking for: ${oldUrl.substring(
          0,
          200
        )}...`
      );
    }

    // Check if the old URL appears multiple times
    const occurrences = content.split(oldUrl).length - 1;
    if (occurrences > 1) {
      throw new Error(
        `Old URL appears ${occurrences} times in ${file_path}. Please provide more specific URL text to avoid ambiguity.`
      );
    }

    // 🚨 CRITICAL: Validate the replacement will cause minimal change
    const originalLength = content.length;
    const afterReplacement = content.replace(oldUrl, newUrl);
    const newLength = afterReplacement.length;
    const difference = Math.abs(originalLength - newLength);

    // For URL edits, the difference should be small (typically just added/removed parameters)
    if (difference > 1000) {
      throw new Error(
        `🚨 URL EDIT SAFETY CHECK FAILED: This URL replacement would change ${difference} characters in the file. URL edits should typically change less than 1000 characters. This suggests the oldUrl parameter might be matching more content than intended.`
      );
    }

    // Log the change details for debugging
    console.log("📊 URL edit summary:", {
      originalLength,
      newLength,
      difference,
      oldUrlPreview:
        oldUrl.substring(0, 150) + (oldUrl.length > 150 ? "..." : ""),
      newUrlPreview:
        newUrl.substring(0, 150) + (newUrl.length > 150 ? "..." : ""),
    });

    // Replace the old URL with the new URL
    const updatedContent = afterReplacement;

    // Update the file
    const { createOrUpdateFile } = await import("./github/github-utils.js");
    await createOrUpdateFile(
      file_path,
      updatedContent,
      message,
      repository,
      branch
    );

    console.log("✅ executeEditUrl completed successfully");

    return {
      success: true,
      message: `Successfully updated URL in ${file_path} (${difference} character difference)`,
    };
  } catch (error) {
    console.error("❌ Error in executeEditUrl:", error);
    throw error;
  }
};

// Action control tools
export const executeEndActions = async (
  {
    reason,
    summary,
    nextSteps,
  }: {
    reason: string;
    summary: string;
    nextSteps?: string;
  },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is ending actions: ${reason}`);

  const endMessage = `🛑 **Actions Complete**

**Reason:** ${reason}

**Summary:** ${summary}

${nextSteps ? `**Next Steps:** ${nextSteps}` : ""}

*No further actions will be taken at this time.*`;

  return {
    success: true,
    message: endMessage,
    shouldStop: true, // Signal to stop processing
  };
};

export const executeResetBranchToHead = async (
  {
    repository,
    branch,
    baseBranch,
  }: {
    repository: string;
    branch: string;
    baseBranch?: string;
  },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is resetting branch ${branch} to head...`);

  try {
    const { resetBranchToHead } = await import("./github/github-utils.js");

    await resetBranchToHead(repository, branch, baseBranch);

    return {
      success: true,
      message: `Successfully reset branch ${branch} to head of ${
        baseBranch || "default branch"
      }`,
    };
  } catch (error) {
    console.error(`Error resetting branch ${branch}:`, error);
    return {
      success: false,
      message: `Failed to reset branch ${branch}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
};

export const executeAnalyzeFileStructure = async (
  {
    file_path,
    repository,
    branch,
  }: {
    file_path: string;
    repository: string;
    branch: string;
  },
  updateStatus?: (status: string) => void
) => {
  try {
    updateStatus?.("Analyzing file structure...");

    const branchToUse = branch && branch.trim() ? branch : undefined;
    const analysis = await advancedFileReader.analyzeFileStructure(
      file_path,
      repository,
      branchToUse
    );

    const summary = `File Analysis: ${analysis.path}
Language: ${analysis.language}
Total Lines: ${analysis.totalLines}

Functions (${analysis.functions.length}):
${analysis.functions
  .map((f: any) => `  - ${f.name} (lines ${f.startLine}-${f.endLine})`)
  .join("\n")}

Classes (${analysis.classes.length}):
${analysis.classes
  .map((c: any) => `  - ${c.name} (lines ${c.startLine}-${c.endLine})`)
  .join("\n")}

Imports (${analysis.imports.length}):
${analysis.imports
  .map((i: any) => `  - ${i.module} (line ${i.line})`)
  .join("\n")}

Exports (${analysis.exports.length}):
${analysis.exports
  .map((e: any) => `  - ${e.name} (${e.type}, line ${e.line})`)
  .join("\n")}

Dependencies: ${analysis.dependencies.join(", ")}

Complexity:
  - Cyclomatic: ${analysis.complexity.cyclomaticComplexity}
  - Cognitive: ${analysis.complexity.cognitiveComplexity}
  - Maintainability: ${analysis.complexity.maintainabilityIndex}`;

    updateStatus?.("File structure analyzed successfully");
    return summary;
  } catch (error) {
    const errorMessage = `Failed to analyze file structure: ${
      error instanceof Error ? error.message : String(error)
    }`;
    updateStatus?.(errorMessage);
    return errorMessage;
  }
};

export const executeSearchCodeWithContext = async (
  {
    pattern,
    repository,
    filePattern,
    contextLines,
    maxResults,
    branch,
  }: {
    pattern: string;
    repository: string;
    filePattern: string;
    contextLines: number;
    maxResults: number;
    branch: string;
  },
  updateStatus?: (status: string) => void
) => {
  try {
    updateStatus?.("Searching code with context...");

    const options: any = {
      contextLines: contextLines > 0 ? contextLines : 3, // default to 3
      maxResults: maxResults > 0 ? maxResults : 10, // default to 10
    };

    if (filePattern && filePattern.trim()) options.filePattern = filePattern;
    if (branch && branch.trim()) options.branch = branch;

    const searchResults = await advancedFileReader.searchWithContext(
      pattern,
      repository,
      options
    );

    const summary = `Search Results for "${pattern}":

${searchResults
  .map(
    (file: any) => `
File: ${file.file_path}
${file.matches
  .map(
    (match: any) => `
  Line ${match.line}: ${match.content}
  Context:
${match.context.map((ctx: any) => `    ${ctx}`).join("\n")}
`
  )
  .join("\n")}
`
  )
  .join("\n---\n")}

Total files with matches: ${searchResults.length}
Total matches: ${searchResults.reduce(
      (sum: number, file: any) => sum + file.matches.length,
      0
    )}`;

    updateStatus?.("Code search completed successfully");
    return summary;
  } catch (error) {
    const errorMessage = `Failed to search code with context: ${
      error instanceof Error ? error.message : String(error)
    }`;
    updateStatus?.(errorMessage);
    return errorMessage;
  }
};
