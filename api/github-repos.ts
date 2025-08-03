import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withInternalAccess } from "../lib/core/auth.js";
import { addCorsHeaders } from "../lib/core/cors.js";
import { env } from "../lib/core/env.js";
import { GitHubAppService } from "../lib/github/github-app.js";

// Initialize GitHub App service
const githubAppService = GitHubAppService.getInstance();

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  html_url: string;
  clone_url: string;
  ssh_url: string;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  default_branch: string;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  size: number;
  owner: {
    login: string;
    avatar_url: string;
    type: string;
  };
  topics: string[];
}

export interface GitHubInstallation {
  id: number;
  account: {
    login: string;
    avatar_url: string;
    type: string;
  };
  repository_selection: string;
  html_url: string;
  created_at: string;
  updated_at: string;
}

async function handler(req: VercelRequest, res: VercelResponse) {
  // Add CORS headers
  const isPreflight = addCorsHeaders(req, res);
  if (isPreflight) {
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const {
      installation_id,
      per_page = 30,
      page = 1,
      sort = "updated",
      direction = "desc",
    } = req.query;

    if (installation_id && typeof installation_id === "string") {
      // Get repositories for a specific installation
      await getInstallationRepos(
        res,
        Number.parseInt(installation_id),
        Number.parseInt(per_page as string),
        Number.parseInt(page as string),
        sort as string,
        direction as string,
      );
      return;
    }
    // Get all installations
    await getInstallations(res);
  } catch (error) {
    console.error("Error in github-repos endpoint:", error);
    res.status(500).json({
      error: "Internal server error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function getInstallations(res: VercelResponse) {
  try {
    const installations = await githubAppService.getInstallations();

    const formattedInstallations: GitHubInstallation[] = installations.map(
      (installation: any) => ({
        id: installation.id,
        account: {
          login: installation.account?.login || "",
          avatar_url: installation.account?.avatar_url || "",
          type: installation.account?.type || "User",
        },
        repository_selection: installation.repository_selection || "all",
        html_url: installation.html_url || "",
        created_at: installation.created_at || "",
        updated_at: installation.updated_at || "",
      }),
    );

    res.status(200).json({
      installations: formattedInstallations,
      totalCount: formattedInstallations.length,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("Error fetching GitHub installations:", error);
    res.status(500).json({
      error: "Failed to fetch GitHub installations",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function getInstallationRepos(
  res: VercelResponse,
  installationId: number,
  perPage: number,
  page: number,
  sort: string,
  direction: string,
) {
  try {
    // Get Octokit client for this installation
    const octokit =
      await githubAppService.getOctokitForInstallation(installationId);

    // Fetch repositories for this installation
    const { data } = await octokit.apps.listReposAccessibleToInstallation({
      per_page: Math.min(perPage, 100), // GitHub API max is 100
      page: Math.max(page, 1),
    });

    // Format repositories
    const formattedRepos: GitHubRepo[] = data.repositories.map((repo: any) => ({
      id: repo.id,
      name: repo.name,
      full_name: repo.full_name,
      description: repo.description,
      private: repo.private,
      html_url: repo.html_url,
      clone_url: repo.clone_url,
      ssh_url: repo.ssh_url,
      language: repo.language,
      stargazers_count: repo.stargazers_count,
      forks_count: repo.forks_count,
      open_issues_count: repo.open_issues_count,
      default_branch: repo.default_branch,
      created_at: repo.created_at || "",
      updated_at: repo.updated_at || "",
      pushed_at: repo.pushed_at || repo.updated_at || "",
      size: repo.size,
      owner: {
        login: repo.owner.login,
        avatar_url: repo.owner.avatar_url,
        type: repo.owner.type,
      },
      topics: repo.topics || [],
    }));

    // Sort repositories if requested
    if (
      sort &&
      ["name", "updated", "created", "pushed", "size", "stargazers"].includes(
        sort,
      )
    ) {
      formattedRepos.sort((a, b) => {
        let aValue: any;
        let bValue: any;

        switch (sort) {
          case "name":
            aValue = a.name.toLowerCase();
            bValue = b.name.toLowerCase();
            break;
          case "updated":
            aValue = new Date(a.updated_at).getTime();
            bValue = new Date(b.updated_at).getTime();
            break;
          case "created":
            aValue = new Date(a.created_at).getTime();
            bValue = new Date(b.created_at).getTime();
            break;
          case "pushed":
            aValue = new Date(a.pushed_at).getTime();
            bValue = new Date(b.pushed_at).getTime();
            break;
          case "size":
            aValue = a.size;
            bValue = b.size;
            break;
          case "stargazers":
            aValue = a.stargazers_count;
            bValue = b.stargazers_count;
            break;
          default:
            return 0;
        }

        if (direction === "desc") {
          return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
        }
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
      });
    }

    res.status(200).json({
      repositories: formattedRepos,
      totalCount: data.total_count,
      page: page,
      perPage: perPage,
      hasNextPage: formattedRepos.length === perPage,
      installationId: installationId,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error(
      `Error fetching repositories for installation ${installationId}:`,
      error,
    );
    res.status(500).json({
      error: "Failed to fetch repositories",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

// Export the handler with internal access protection
export default withInternalAccess(handler);
