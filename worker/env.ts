import "dotenv/config";

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

export const workerEnv = {
  // Upstash Redis (same instance as Vercel — tokens live here)
  REDIS_URL: required("KV_REST_API_URL"),
  REDIS_TOKEN: required("KV_REST_API_TOKEN"),

  // GitHub App credentials (same as Vercel — generates installation tokens)
  GITHUB_APP_ID: required("GITHUB_APP_ID"),
  GITHUB_APP_PRIVATE_KEY: required("GITHUB_APP_PRIVATE_KEY"),
  GITHUB_APP_CLIENT_ID: required("GITHUB_APP_CLIENT_ID"),
  GITHUB_APP_CLIENT_SECRET: required("GITHUB_APP_CLIENT_SECRET"),

  // Anthropic API key (for LLM summarization of task output)
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,

  // Slack bot token
  SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,

  // Worker settings
  REPOS_DIR: process.env.REPOS_DIR || `${process.env.HOME}/otron-repos`,
};
