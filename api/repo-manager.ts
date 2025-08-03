import { Redis } from "@upstash/redis";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withInternalAccess } from "../lib/core/auth.js";
import { addCorsHeaders } from "../lib/core/cors.js";
import { env } from "../lib/core/env.js";

// Initialize Redis client
const redis = new Redis({
  url: env.KV_REST_API_URL,
  token: env.KV_REST_API_TOKEN,
});

export interface RepoDefinition {
  id: string;
  name: string;
  description: string;
  purpose: string;
  githubUrl: string;
  owner: string;
  repo: string;
  isActive: boolean;
  tags: string[];
  contextDescription: string;
  createdAt: number;
  updatedAt: number;
}

// Redis key structure for repository definitions
const getRepoDefinitionsKey = () => "repo_definitions";
const getRepoDefinitionKey = (id: string) => `repo_definition:${id}`;

async function handler(req: VercelRequest, res: VercelResponse) {
  // Add CORS headers
  const isPreflight = addCorsHeaders(req, res);
  if (isPreflight) {
    return;
  }

  try {
    switch (req.method) {
      case "GET":
        return await handleGet(req, res);
      case "POST":
        return await handlePost(req, res);
      case "PUT":
        return await handlePut(req, res);
      case "DELETE":
        return await handleDelete(req, res);
      default:
        return res.status(405).json({ error: "Method not allowed" });
    }
  } catch (error) {
    console.error("Error in repo-manager endpoint:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleGet(req: VercelRequest, res: VercelResponse) {
  const { id } = req.query;

  if (id && typeof id === "string") {
    // Get single repository definition
    const repoDefinition = await redis.get(getRepoDefinitionKey(id));

    if (!repoDefinition) {
      return res.status(404).json({ error: "Repository definition not found" });
    }

    let parsedDefinition: RepoDefinition;
    try {
      parsedDefinition =
        typeof repoDefinition === "string"
          ? JSON.parse(repoDefinition)
          : (repoDefinition as RepoDefinition);
    } catch (error) {
      console.error("Error parsing repository definition:", error);
      return res
        .status(500)
        .json({ error: "Invalid repository definition data" });
    }

    return res.status(200).json(parsedDefinition);
  }
  // Get all repository definitions
  const repoIds = await redis.smembers(getRepoDefinitionsKey());
  const definitions: RepoDefinition[] = [];

  for (const repoId of repoIds) {
    try {
      const repoDefinition = await redis.get(getRepoDefinitionKey(repoId));
      if (repoDefinition) {
        const parsedDefinition =
          typeof repoDefinition === "string"
            ? JSON.parse(repoDefinition)
            : (repoDefinition as RepoDefinition);
        definitions.push(parsedDefinition);
      }
    } catch (error) {
      console.error(`Error parsing repository definition ${repoId}:`, error);
      // Continue with other definitions
    }
  }

  // Sort by updatedAt descending
  definitions.sort((a, b) => b.updatedAt - a.updatedAt);

  return res.status(200).json({
    definitions,
    totalCount: definitions.length,
    timestamp: Date.now(),
  });
}

async function handlePost(req: VercelRequest, res: VercelResponse) {
  const {
    name,
    description,
    purpose,
    githubUrl,
    isActive = true,
    tags = [],
    contextDescription,
  } = req.body;

  // Validate required fields
  if (!name || !description || !githubUrl) {
    return res.status(400).json({
      error: "Missing required fields: name, description, githubUrl",
    });
  }

  // Parse GitHub URL to extract owner and repo
  let owner: string;
  let repo: string;
  try {
    const urlMatch = githubUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!urlMatch) {
      throw new Error("Invalid GitHub URL format");
    }
    [, owner, repo] = urlMatch;

    // Remove .git suffix if present
    repo = repo.replace(/\.git$/, "");
  } catch (error) {
    return res.status(400).json({
      error:
        "Invalid GitHub URL format. Expected: https://github.com/owner/repo",
    });
  }

  const id = `${owner}-${repo}-${Date.now()}`;
  const now = Date.now();

  const repoDefinition: RepoDefinition = {
    id,
    name,
    description,
    purpose: purpose || "",
    githubUrl,
    owner,
    repo,
    isActive,
    tags: Array.isArray(tags) ? tags : [],
    contextDescription: contextDescription || "",
    createdAt: now,
    updatedAt: now,
  };

  try {
    // Store the repository definition
    await redis.set(getRepoDefinitionKey(id), JSON.stringify(repoDefinition));

    // Add to the set of repository IDs
    await redis.sadd(getRepoDefinitionsKey(), id);

    return res.status(201).json(repoDefinition);
  } catch (error) {
    console.error("Error storing repository definition:", error);
    return res.status(500).json({
      error: "Failed to create repository definition",
    });
  }
}

async function handlePut(req: VercelRequest, res: VercelResponse) {
  const { id } = req.query;

  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "Repository ID is required" });
  }

  // Get existing definition
  const existingDefinition = await redis.get(getRepoDefinitionKey(id));
  if (!existingDefinition) {
    return res.status(404).json({ error: "Repository definition not found" });
  }

  let parsed: RepoDefinition;
  try {
    parsed =
      typeof existingDefinition === "string"
        ? JSON.parse(existingDefinition)
        : (existingDefinition as RepoDefinition);
  } catch (error) {
    return res.status(500).json({ error: "Invalid existing repository data" });
  }

  const {
    name,
    description,
    purpose,
    githubUrl,
    isActive,
    tags,
    contextDescription,
  } = req.body;

  // Update fields if provided
  const updatedDefinition: RepoDefinition = {
    ...parsed,
    ...(name !== undefined && { name }),
    ...(description !== undefined && { description }),
    ...(purpose !== undefined && { purpose }),
    ...(githubUrl !== undefined && { githubUrl }),
    ...(isActive !== undefined && { isActive }),
    ...(tags !== undefined && { tags: Array.isArray(tags) ? tags : [] }),
    ...(contextDescription !== undefined && { contextDescription }),
    updatedAt: Date.now(),
  };

  // If GitHub URL changed, update owner/repo
  if (githubUrl && githubUrl !== parsed.githubUrl) {
    try {
      const urlMatch = githubUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
      if (!urlMatch) {
        throw new Error("Invalid GitHub URL format");
      }
      const [, newOwner, newRepo] = urlMatch;
      updatedDefinition.owner = newOwner;
      updatedDefinition.repo = newRepo.replace(/\.git$/, "");
    } catch (error) {
      return res.status(400).json({
        error:
          "Invalid GitHub URL format. Expected: https://github.com/owner/repo",
      });
    }
  }

  try {
    await redis.set(
      getRepoDefinitionKey(id),
      JSON.stringify(updatedDefinition),
    );
    return res.status(200).json(updatedDefinition);
  } catch (error) {
    console.error("Error updating repository definition:", error);
    return res.status(500).json({
      error: "Failed to update repository definition",
    });
  }
}

async function handleDelete(req: VercelRequest, res: VercelResponse) {
  const { id } = req.query;

  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "Repository ID is required" });
  }

  try {
    // Check if definition exists
    const exists = await redis.get(getRepoDefinitionKey(id));
    if (!exists) {
      return res.status(404).json({ error: "Repository definition not found" });
    }

    // Remove from Redis
    await redis.del(getRepoDefinitionKey(id));
    await redis.srem(getRepoDefinitionsKey(), id);

    return res.status(200).json({
      success: true,
      message: `Repository definition ${id} deleted successfully`,
    });
  } catch (error) {
    console.error("Error deleting repository definition:", error);
    return res.status(500).json({
      error: "Failed to delete repository definition",
    });
  }
}

// Export the handler with internal access protection
export default withInternalAccess(handler);
