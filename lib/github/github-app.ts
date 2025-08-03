import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { env } from "../core/env.js";

export class GitHubAppService {
  private static instance: GitHubAppService;
  private appOctokit: Octokit;
  private installationTokenCache: Map<
    number,
    { token: string; expires: Date }
  > = new Map();

  private constructor() {
    // Make sure we have all required environment variables
    if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) {
      throw new Error(
        "GitHub App credentials missing. Please set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY.",
      );
    }

    // Create an Octokit instance authenticated as the GitHub App
    this.appOctokit = new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: env.GITHUB_APP_ID,
        privateKey: env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n"),
        clientId: env.GITHUB_APP_CLIENT_ID,
        clientSecret: env.GITHUB_APP_CLIENT_SECRET,
      },
    });
  }

  /**
   * Get the singleton instance of GitHubAppService
   */
  public static getInstance(): GitHubAppService {
    if (!GitHubAppService.instance) {
      GitHubAppService.instance = new GitHubAppService();
    }
    return GitHubAppService.instance;
  }

  /**
   * Get an authenticated Octokit client for a specific repository
   * @param repoFullName Repository name in owner/repo format
   */
  public async getOctokitForRepo(repoFullName: string): Promise<Octokit> {
    const [owner, repo] = repoFullName.split("/");

    // Get the installation ID for this repository
    const { data: installation } =
      await this.appOctokit.apps.getRepoInstallation({
        owner,
        repo,
      });

    // Get an installation token for this installation
    const installationToken = await this.getInstallationToken(installation.id);

    // Create a new Octokit instance with the installation token
    return new Octokit({
      auth: installationToken,
    });
  }

  /**
   * Get an authenticated Octokit client for a specific installation ID
   * @param installationId GitHub App installation ID
   */
  public async getOctokitForInstallation(
    installationId: number,
  ): Promise<Octokit> {
    const installationToken = await this.getInstallationToken(installationId);

    return new Octokit({
      auth: installationToken,
    });
  }

  /**
   * Get all installations of this GitHub App
   * Properly typed to avoid TypeScript errors
   */
  public async getInstallations(): Promise<
    Array<{
      id: number;
      account: {
        login: string;
        id: number;
        type: string;
      };
    }>
  > {
    const { data } = await this.appOctokit.apps.listInstallations();
    return data as Array<{
      id: number;
      account: {
        login: string;
        id: number;
        type: string;
      };
    }>;
  }

  /**
   * Get repositories accessible by the app for a specific installation
   */
  public async getInstallationRepositories(
    installationId: number,
  ): Promise<string[]> {
    const octokit = await this.getOctokitForInstallation(installationId);
    const { data } = await octokit.apps.listReposAccessibleToInstallation();

    return data.repositories.map((repo) => `${repo.owner.login}/${repo.name}`);
  }

  /**
   * Get an installation token, using a cached one if available and not expired
   */
  private async getInstallationToken(installationId: number): Promise<string> {
    // Check if we have a valid cached token
    const cached = this.installationTokenCache.get(installationId);
    if (cached && cached.expires > new Date()) {
      return cached.token;
    }

    // Get a new token
    const { data } = await this.appOctokit.apps.createInstallationAccessToken({
      installation_id: installationId,
    });

    // Cache the token
    this.installationTokenCache.set(installationId, {
      token: data.token,
      expires: new Date(data.expires_at),
    });

    return data.token;
  }
}
