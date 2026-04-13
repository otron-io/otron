import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { workerEnv } from "./env.js";

let appOctokit: Octokit | undefined;

function getAppOctokit(): Octokit {
  if (!appOctokit) {
    appOctokit = new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: workerEnv.GITHUB_APP_ID,
        privateKey: workerEnv.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n"),
        clientId: workerEnv.GITHUB_APP_CLIENT_ID,
        clientSecret: workerEnv.GITHUB_APP_CLIENT_SECRET,
      },
    });
  }
  return appOctokit;
}

/**
 * Get a short-lived installation token for a repository.
 * Uses the same GitHub App auth as the Vercel side.
 */
export async function getInstallationToken(
  repository: string
): Promise<string> {
  const [owner, repo] = repository.split("/");
  const octokit = getAppOctokit();

  const { data: installation } = await octokit.apps.getRepoInstallation({
    owner,
    repo,
  });

  const { data } = await octokit.apps.createInstallationAccessToken({
    installation_id: installation.id,
  });

  return data.token;
}
