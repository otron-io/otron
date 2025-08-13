import type { Config } from "./config";

export function getDefaultConfig(): Config {
  return {
    labels: {
      "otron-triage": {
        getPromptTemplate: () =>
          `
Troubleshoot whether the reported issue is valid.

Provide a concise and respectful comment summarizing the findings.

### {CODEX_ACTION_ISSUE_TITLE}

{CODEX_ACTION_ISSUE_BODY}
`.trim(),
      },
      "otron-rust-review": {
        getPromptTemplate: () =>
          `
Review this PR with a focus on Rust code quality, safety, and idiomatic usage. Respond with a concise final message in Markdown.

There should be a short summary (1-2 sentences) and a few bullet points if necessary.

{CODEX_ACTION_GITHUB_EVENT_PATH} contains the JSON that triggered this GitHub workflow. It contains the \`base\` and \`head\` refs that define this PR. Both refs are available locally.
`.trim(),
      },
      "otron-review": {
        getPromptTemplate: () =>
          `
Review this PR and respond with a very concise final message, formatted in Markdown.

There should be a summary of the changes (1-2 sentences) and a few bullet points if necessary.

Then provide the **review** (1-2 sentences plus bullet points, friendly tone).

{CODEX_ACTION_GITHUB_EVENT_PATH} contains the JSON that triggered this GitHub workflow. It contains the \`base\` and \`head\` refs that define this PR. Both refs are available locally.
`.trim(),
      },
      "otron-attempt": {
        getPromptTemplate: () =>
          `
Attempt to solve the reported issue.

If a code change is required, create a new branch, commit the fix, and open a pull-request that resolves the problem.

### {CODEX_ACTION_ISSUE_TITLE}

{CODEX_ACTION_ISSUE_BODY}
`.trim(),
      },
    },
  };
}
