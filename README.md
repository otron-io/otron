# Linear Agent

A fully autonomous AI assistant that helps improve Linear tickets by analyzing issues, filling in missing information, answering questions about tickets, and autonomously implementing code changes across multiple repositories.

## Features

- Automatically analyses new tickets for missing information
- Answers questions about tickets when mentioned
- Refines tickets with detailed suggestions when requested
- Integrates directly with Linear as a teammate
- **Cross-Repository Autonomous Developer**
  - Generates in-depth technical analysis reports for issues
  - Identifies relevant code across your allowed repositories using GitHub code search
  - Implements code changes to fix issues in multiple repositories simultaneously
  - Creates pull requests with solutions for each affected repository

### Required Environment Variables

To use the autonomous developer features, you need to add the following environment variables:

```
GITHUB_TOKEN=your_github_token
REPO_OWNER=your_github_username_or_org
REPO_NAME=your_repository_name
REPO_BASE_BRANCH=main
ALLOWED_REPOSITORIES=owner1/repo1,owner2/repo2,owner3/repo3
```

The variables serve these purposes:

- `GITHUB_TOKEN`: Authentication for GitHub API access (needs read/write permissions)
- `REPO_OWNER` and `REPO_NAME`: Default repository for changes if none specified
- `REPO_BASE_BRANCH`: Default branch to base PRs on (usually "main" or "master")
- `ALLOWED_REPOSITORIES`: Comma-separated list of repositories the agent can search and modify

## Usage

Mention the agent in any ticket:

- `@Agent What's missing from this ticket?`
- `@Agent refine`
- `@Agent What dependencies should I consider?`

### Multi-Repository Developer Agent

Simply tag the agent in a comment or assign it to an issue, and it will autonomously:

1. Analyze the issue to understand the problem
2. Search for relevant code files across ALL allowed repositories
3. Generate a detailed technical analysis
4. Post the analysis as a comment on the issue
5. Determine if code changes should be implemented
6. Generate and implement code changes across multiple repositories if needed
7. Create separate pull requests for each repository that needs changes
8. Link all the PRs back to the Linear issue with a summary

The agent is particularly responsive to these keywords in comments:

- `analyze`
- `fix`
- `implement`
- `technical`

### Controlling Behavior

You can explicitly control behavior with these labels:

- `agent:implement` - Always implement changes and create PRs
- `agent:analysis-only` - Only provide analysis, don't implement

## Development

```bash
npm install
npm run dev
```

Built with Vercel AI SDK, Linear API, Upstash Redis, Claude/gpt-4.1, and GitHub API integration.
