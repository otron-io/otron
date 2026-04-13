import { tool } from "ai";
import { z } from "zod";
import { LinearClient } from "@linear/sdk";
import {
  executeGetIssueContext,
  executeUpdateIssueStatus,
  executeAddLabel,
  executeRemoveLabel,
  executeAssignIssue,
  executeCreateIssue,
  executeAddIssueAttachment,
  executeUpdateIssuePriority,
  executeSetPointEstimate,
  executeGetLinearTeams,
  executeGetLinearProjects,
  executeGetLinearInitiatives,
  executeGetLinearUsers,
  executeGetLinearRecentIssues,
  executeSearchLinearIssues,
  executeGetLinearWorkflowStates,
  executeCreateLinearComment,
  executeCreateAgentActivity,
  executeSetIssueParent,
  executeAddIssueToProject,
} from "../linear-tools.js";

type ToolExecutorWrapper = (
  name: string,
  fn: Function
) => (...args: any[]) => any;

export function createLinearTools(
  executor: ToolExecutorWrapper,
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient
) {
  return {
    getIssueContext: tool({
      description:
        "Get the context for a Linear issue including comments, child issues, and parent issue",
      parameters: z.object({
        issueId: z
          .string()
          .describe('The Linear issue ID or identifier (e.g., "OTR-123")'),
        commentId: z
          .string()
          .describe(
            "Optional comment ID to highlight. Leave empty if not highlighting a specific comment."
          ),
      }),
      execute: executor("getIssueContext", (params: any) =>
        executeGetIssueContext(
          params as { issueId: string; commentId: string },
          updateStatus,
          linearClient
        )
      ),
    }),

    updateIssueStatus: tool({
      description: "Update the status of a Linear issue",
      parameters: z.object({
        issueId: z
          .string()
          .describe('The Linear issue ID or identifier (e.g., "OTR-123")'),
        statusName: z
          .string()
          .describe(
            'The name of the status to set (e.g., "In Progress", "Done")'
          ),
      }),
      execute: executor("updateIssueStatus", (params: any) =>
        executeUpdateIssueStatus(
          params as { issueId: string; statusName: string },
          updateStatus,
          linearClient
        )
      ),
    }),

    addLabel: tool({
      description: "Add a label to a Linear issue",
      parameters: z.object({
        issueId: z
          .string()
          .describe('The Linear issue ID or identifier (e.g., "OTR-123")'),
        labelName: z.string().describe("The name of the label to add"),
      }),
      execute: executor("addLabel", (params: any) =>
        executeAddLabel(
          params as { issueId: string; labelName: string },
          updateStatus,
          linearClient
        )
      ),
    }),

    removeLabel: tool({
      description: "Remove a label from a Linear issue",
      parameters: z.object({
        issueId: z
          .string()
          .describe('The Linear issue ID or identifier (e.g., "OTR-123")'),
        labelName: z.string().describe("The name of the label to remove"),
      }),
      execute: executor("removeLabel", (params: any) =>
        executeRemoveLabel(
          params as { issueId: string; labelName: string },
          updateStatus,
          linearClient
        )
      ),
    }),

    assignIssue: tool({
      description: "Assign a Linear issue to a team member",
      parameters: z.object({
        issueId: z
          .string()
          .describe('The Linear issue ID or identifier (e.g., "OTR-123")'),
        assigneeEmail: z
          .string()
          .describe("The email address of the person to assign the issue to"),
      }),
      execute: executor("assignIssue", (params: any) =>
        executeAssignIssue(
          params as { issueId: string; assigneeEmail: string },
          updateStatus,
          linearClient
        )
      ),
    }),

    createIssue: tool({
      description: "Create a new Linear issue",
      parameters: z.object({
        teamId: z
          .string()
          .describe(
            'The Linear team ID (UUID), team key (e.g., "OTR"), or team name'
          ),
        title: z.string().describe("The title of the new issue"),
        description: z.string().describe("The description of the new issue"),
        status: z.string().describe("Status name for the new issue."),
        priority: z
          .number()
          .describe("Priority level (1-4, where 1 is highest)."),
        parentIssueId: z
          .string()
          .describe(
            "Parent issue ID to create this as a child issue. Only leave empty if this is not a child issue."
          ),
        projectId: z.string().describe("Project ID to create this issue in."),
      }),
      execute: executor("createIssue", (params: any) =>
        executeCreateIssue(
          params as {
            teamId: string;
            title: string;
            description: string;
            status: string;
            priority: number;
            parentIssueId: string;
            projectId: string;
          },
          updateStatus,
          linearClient
        )
      ),
    }),

    addIssueAttachment: tool({
      description: "Add a URL attachment to a Linear issue",
      parameters: z.object({
        issueId: z
          .string()
          .describe('The Linear issue ID or identifier (e.g., "OTR-123")'),
        url: z.string().describe("The URL to attach"),
        title: z.string().describe("The title for the attachment"),
      }),
      execute: executor("addIssueAttachment", (params: any) =>
        executeAddIssueAttachment(
          params as { issueId: string; url: string; title: string },
          updateStatus,
          linearClient
        )
      ),
    }),

    updateIssuePriority: tool({
      description: "Update the priority of a Linear issue",
      parameters: z.object({
        issueId: z
          .string()
          .describe('The Linear issue ID or identifier (e.g., "OTR-123")'),
        priority: z
          .number()
          .describe("The priority level (1-4, where 1 is highest)"),
      }),
      execute: executor("updateIssuePriority", (params: any) =>
        executeUpdateIssuePriority(
          params as { issueId: string; priority: number },
          updateStatus,
          linearClient
        )
      ),
    }),

    setPointEstimate: tool({
      description: "Set the point estimate for a Linear issue",
      parameters: z.object({
        issueId: z
          .string()
          .describe('The Linear issue ID or identifier (e.g., "OTR-123")'),
        pointEstimate: z.number().describe("The point estimate value"),
      }),
      execute: executor("setPointEstimate", (params: any) =>
        executeSetPointEstimate(
          params as { issueId: string; pointEstimate: number },
          updateStatus,
          linearClient
        )
      ),
    }),

    // Linear context gathering tools
    getLinearTeams: tool({
      description:
        "Get all teams in the Linear workspace with details about members and active issues",
      parameters: z.object({}),
      execute: executor("getLinearTeams", async () => {
        return await executeGetLinearTeams(updateStatus, linearClient);
      }),
    }),

    getLinearProjects: tool({
      description:
        "Get all projects in the Linear workspace with their IDs, status, progress, and team information",
      parameters: z.object({}),
      execute: executor("getLinearProjects", async () => {
        return await executeGetLinearProjects(updateStatus, linearClient);
      }),
    }),

    getLinearInitiatives: tool({
      description:
        "Get all initiatives in the Linear workspace with their IDs, associated projects and progress",
      parameters: z.object({}),
      execute: executor("getLinearInitiatives", async () => {
        return await executeGetLinearInitiatives(updateStatus, linearClient);
      }),
    }),

    getLinearUsers: tool({
      description:
        "Get all users in the Linear workspace with their IDs, details and status",
      parameters: z.object({}),
      execute: executor("getLinearUsers", async () => {
        return await executeGetLinearUsers(updateStatus, linearClient);
      }),
    }),

    getLinearRecentIssues: tool({
      description:
        "Get recent issues from the Linear workspace, optionally filtered by team",
      parameters: z.object({
        limit: z
          .number()
          .describe(
            "Number of issues to retrieve (default: 20). Use 20 if not specified."
          ),
        teamId: z
          .string()
          .describe(
            "Optional team ID to filter issues. Leave empty to get issues from all teams."
          ),
      }),
      execute: executor("getLinearRecentIssues", async (params: any) => {
        return await executeGetLinearRecentIssues(
          params,
          updateStatus,
          linearClient
        );
      }),
    }),

    searchLinearIssues: tool({
      description:
        "Search for Linear issues by text query in title and description",
      parameters: z.object({
        query: z
          .string()
          .describe(
            "The search query to find in issue titles and descriptions"
          ),
        limit: z
          .number()
          .describe(
            "Number of results to return (default: 10). Use 10 if not specified."
          ),
      }),
      execute: executor("searchLinearIssues", async (params: any) => {
        return await executeSearchLinearIssues(
          params,
          updateStatus,
          linearClient
        );
      }),
    }),

    getLinearWorkflowStates: tool({
      description:
        "Get workflow states (statuses) for teams in the Linear workspace",
      parameters: z.object({
        teamId: z
          .string()
          .describe(
            "Optional team ID to filter workflow states. Leave empty to get states for all teams."
          ),
      }),
      execute: executor("getLinearWorkflowStates", async (params: any) => {
        return await executeGetLinearWorkflowStates(
          params,
          updateStatus,
          linearClient
        );
      }),
    }),

    createLinearComment: tool({
      description: "Create a comment on a Linear issue",
      parameters: z.object({
        issueId: z
          .string()
          .describe('The Linear issue ID or identifier (e.g., "OTR-123")'),
        body: z.string().describe("The comment text to add"),
      }),
      execute: executor("createLinearComment", async (params: any) => {
        return await executeCreateLinearComment(
          params,
          updateStatus,
          linearClient
        );
      }),
    }),

    setIssueParent: tool({
      description:
        "Set an issue as a child of another issue (parent-child relationship)",
      parameters: z.object({
        issueId: z
          .string()
          .describe(
            'The ID or identifier of the issue to make a child (e.g., "OTR-123")'
          ),
        parentIssueId: z
          .string()
          .describe(
            'The ID or identifier of the parent issue (e.g., "OTR-456")'
          ),
      }),
      execute: executor("setIssueParent", async (params: any) => {
        return await executeSetIssueParent(
          params,
          updateStatus,
          linearClient
        );
      }),
    }),

    addIssueToProject: tool({
      description: "Add an issue to a Linear project",
      parameters: z.object({
        issueId: z
          .string()
          .describe(
            'The ID or identifier of the issue to add (e.g., "OTR-123")'
          ),
        projectId: z
          .string()
          .describe("The ID of the project to add the issue to"),
      }),
      execute: executor("addIssueToProject", async (params: any) => {
        return await executeAddIssueToProject(
          params,
          updateStatus,
          linearClient
        );
      }),
    }),

    createAgentActivity: tool({
      description:
        "Create a Linear agent activity (thought, action, response, error, or elicitation). Use response for any output to the user in the chat.",
      parameters: z.object({
        sessionId: z.string().describe("The Linear agent session ID"),
        activityType: z
          .enum(["thought", "action", "response", "error", "elicitation"])
          .describe("The type of activity to create"),
        body: z
          .string()
          .describe(
            "The body text (required for thought, response, error, elicitation types, use empty string if not needed)"
          ),
        action: z
          .string()
          .describe(
            "The action description (required for action type, use empty string if not needed)"
          ),
        parameter: z
          .string()
          .describe(
            "The action parameter (required for action type, use empty string if not needed)"
          ),
        result: z
          .string()
          .describe(
            "The action result (optional for action type, use empty string if not provided)"
          ),
      }),
      execute: executor("createAgentActivity", async (params: any) => {
        return await executeCreateAgentActivity(
          params,
          updateStatus,
          linearClient
        );
      }),
    }),
  };
}
