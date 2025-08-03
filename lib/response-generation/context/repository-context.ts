import { Redis } from "@upstash/redis";
import { env } from "../../core/env.js";
import type { RepoDefinition } from "../core/types.js";

// Initialize Redis client for repository context
const redis = new Redis({
  url: env.KV_REST_API_URL,
  token: env.KV_REST_API_TOKEN,
});

/**
 * Fetch active repository definitions for system context
 */
export async function getRepositoryContext(): Promise<string> {
  try {
    // Get all repository definition IDs
    const repoIds = await redis.smembers("repo_definitions");
    if (!repoIds || repoIds.length === 0) {
      return "";
    }

    const activeRepos: RepoDefinition[] = [];

    // Fetch each repository definition
    for (const repoId of repoIds) {
      try {
        const repoData = await redis.get(`repo_definition:${repoId}`);
        if (repoData) {
          const parsedRepo =
            typeof repoData === "string"
              ? JSON.parse(repoData)
              : (repoData as RepoDefinition);

          // Only include active repositories
          if (parsedRepo.isActive) {
            activeRepos.push(parsedRepo);
          }
        }
      } catch (error) {
        console.error(`Error parsing repository definition ${repoId}:`, error);
        // Continue with other repositories
      }
    }

    if (activeRepos.length === 0) {
      return "";
    }

    // Sort by name for consistent ordering
    activeRepos.sort((a, b) => a.name.localeCompare(b.name));

    // Build context string
    let context =
      "## Repository Context\n\nThe following repositories are available in this environment:\n\n";

    activeRepos.forEach((repo, index) => {
      context += `### ${index + 1}. ${repo.name} (${repo.owner}/${
        repo.repo
      })\n`;
      context += `- **Description**: ${repo.description}\n`;

      if (repo.purpose) {
        context += `- **Purpose**: ${repo.purpose}\n`;
      }

      if (repo.contextDescription) {
        context += `- **Context**: ${repo.contextDescription}\n`;
      }

      if (repo.tags && repo.tags.length > 0) {
        context += `- **Tags**: ${repo.tags.join(", ")}\n`;
      }

      context += `- **GitHub**: ${repo.githubUrl}\n\n`;
    });

    context += "**Repository Guidelines:**\n";
    context +=
      "- When working with code, consider the repository context above\n";
    context +=
      "- Use the appropriate repository for each task based on the descriptions\n";
    context +=
      "- Reference repository purposes when making architectural decisions\n";
    context +=
      "- Consider cross-repository dependencies when making changes\n\n";

    return context;
  } catch (error) {
    console.error("Error fetching repository context:", error);
    return "";
  }
}
