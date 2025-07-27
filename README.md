# Otron

**An omnipresent open source AI agent that lives across your GitHub, Slack, and Linear workspaces.**

Otron seamlessly integrates with your development workflow, automatically responding to webhooks and taking intelligent actions across all three platforms. Whether it's managing Linear issues, creating GitHub pull requests, or sending rich Slack messages, Otron acts as your autonomous development teammate.

## 🚀 Quick Deploy

Deploy Otron to Vercel with one click:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fotron-io%2Fotron&env=OPENAI_API_KEY,ANTHROPIC_API_KEY,LINEAR_CLIENT_ID,LINEAR_CLIENT_SECRET,WEBHOOK_SIGNING_SECRET,REDIRECT_URI,WEBHOOK_URL,GITHUB_APP_ID,GITHUB_APP_PRIVATE_KEY,GITHUB_APP_CLIENT_ID,GITHUB_APP_CLIENT_SECRET,GITHUB_APP_INSTALLATION_ID,SLACK_BOT_TOKEN,SLACK_SIGNING_SECRET,KV_REST_API_URL,KV_REST_API_TOKEN,REPO_BASE_BRANCH,ALLOWED_REPOSITORIES,ADMIN_PASSWORD,INTERNAL_API_TOKEN,VERCEL_URL,FRONTEND_URL&envDescription=Required%20environment%20variables%20for%20Otron%20AI%20Agent&envLink=https%3A%2F%2Fgithub.com%2Fotron-io%2Fotron%23environment-variables&project-name=otron-ai-agent&repository-name=otron-ai-agent)

> **⚠️ Before deploying**: You must create your own OAuth applications for GitHub, Linear, and Slack. See the [setup guide](#creating-oauth-applications) below.

## 🚀 What Otron Does

Otron is an intelligent AI agent that:

- **Listens**: Receives webhooks from Linear, GitHub, and Slack
- **Understands**: Analyzes context using advanced AI models (Claude/GPT-4.1)
- **Acts**: Takes autonomous actions across all platforms
- **Remembers**: Maintains persistent memory of conversations and context
- **Learns**: Improves responses based on past interactions

### Key Capabilities

#### 🎯 Linear Integration

- Automatically analyzes new issues for missing information
- Creates detailed technical specifications and implementation plans
- Updates issue status, priority, and assignments
- Adds labels and comments with context-aware responses
- Links related issues and tracks dependencies

#### 🔧 GitHub Integration

- Searches code repositories using semantic vector embeddings
- Creates branches and pull requests automatically
- Makes precise file edits using advanced editing tools
- Analyzes repository structure and code relationships
- Manages cross-repository changes for complex features

#### 💬 Slack Integration

- Sends rich, interactive messages with Block Kit components
- Responds to button clicks and user interactions
- Manages channels, reactions, and threaded conversations
- Provides real-time updates on development progress
- Creates beautifully formatted status reports

#### 🧠 Intelligent Features

- **Semantic Code Search**: Vector-based code understanding that goes beyond keyword matching
- **Memory System**: Persistent context across conversations and issues
- **Memory Browser**: Advanced interface for browsing, filtering, and managing agent memories
- **Multi-Platform Orchestration**: Coordinates actions across GitHub, Slack, and Linear
- **Goal-Oriented Execution**: Self-evaluates progress and adjusts strategies
- **Interactive Components**: Responds to user interactions and button clicks

## 🛠 Technical Architecture

Built with modern technologies for reliability and performance:

- **AI Models**: Claude Sonnet, GPT-4.1 via Vercel AI SDK
- **Platforms**: Linear SDK, GitHub API, Slack Web API
- **Storage**: Upstash Redis for memory and vector embeddings
- **Deployment**: Vercel serverless functions
- **Language**: TypeScript with comprehensive type safety

### Core Components

- **Response Generator**: Advanced AI prompt engineering with tool execution
- **Memory Manager**: Persistent context and conversation history
- **Memory Browser**: Interactive interface for memory management and analysis
- **Tool Executors**: 50+ tools for cross-platform actions
- **Vector Search**: Semantic code search using OpenAI embeddings
- **Goal Evaluator**: Self-assessment and strategy adjustment

## 🏗 Installation & Setup

### Prerequisites

- Node.js 18+ and npm
- **Vercel account (required)** - Otron is specifically designed for Vercel's serverless platform
- **You must create your own OAuth applications** for GitHub, Linear, and Slack in their respective developer dashboards

> **⚠️ Important**: Otron is built specifically for Vercel and uses Vercel-specific features like serverless functions and environment variables. Other deployment platforms are not supported.

### Creating OAuth Applications

**You must create your own OAuth applications for each platform** - these cannot be shared and must be created in your own developer accounts:

#### Linear App Setup

1. Go to [Linear Settings > API](https://linear.app/settings/api) **in your Linear workspace**
2. Create a new application with these settings:
   - **Name**: Otron (or your preferred name)
   - **Redirect URL**: `https://your-domain.vercel.app/oauth/callback`
   - **Webhook URL**: `https://your-domain.vercel.app/webhook`
   - **Scopes**: `read`, `write`
3. **Copy the Client ID and Client Secret** - you'll need these for environment variables

#### GitHub App Setup

1. Go to [GitHub Settings > Developer settings > GitHub Apps](https://github.com/settings/apps) **in your GitHub account**
2. Create a new GitHub App with these settings:
   - **GitHub App name**: Otron (must be globally unique)
   - **Homepage URL**: `https://your-domain.vercel.app`
   - **Webhook URL**: `https://your-domain.vercel.app/webhook` (optional)
   - **Repository permissions**:
     - Contents: Read & Write
     - Pull requests: Read & Write
     - Issues: Read & Write (optional)
   - **Account permissions**: Email: Read
3. **Generate and download a private key**
4. **Install the app** on your repositories
5. **Copy the App ID, Client ID, Client Secret, and Installation ID**

#### Slack App Setup

1. Go to [Slack API Apps](https://api.slack.com/apps) **using your Slack workspace admin account**
2. Create a new app **from scratch** and configure:
   - **App Name**: Otron
   - **Development Slack Workspace**: Your workspace
   - **OAuth & Permissions**: Add Bot Token Scopes:
     - `chat:write` - Send messages
     - `channels:read` - View basic channel info
     - `users:read` - View basic user info
     - `reactions:write` - Add reactions to messages
     - `channels:history` - View messages in channels (if needed)
   - **Event Subscriptions**:
     - Enable events
     - Request URL: `https://your-domain.vercel.app/api/events`
     - Subscribe to bot events: `message.channels`, `app_mention`
   - **Interactive Components**:
     - Enable interactive components
     - Request URL: `https://your-domain.vercel.app/api/events`
3. **Install the app to your workspace**
4. **Copy the Bot User OAuth Token and Signing Secret**

### Deployment on Vercel

**Otron must be deployed on Vercel** - it uses Vercel-specific serverless functions and will not work on other platforms.

1. Fork this repository to your GitHub account

2. Connect to Vercel:

   ```bash
   npm install -g vercel
   vercel login
   vercel --prod
   ```

3. Set up environment variables in Vercel dashboard or via CLI:

   ```bash
   vercel env add OPENAI_API_KEY
   vercel env add ANTHROPIC_API_KEY
   # ... add all other environment variables
   ```

4. Deploy:
   ```bash
   vercel deploy --prod
   ```

### Environment Variables

Create these environment variables in your Vercel project settings:

```env
# AI & Processing (Required)
OPENAI_API_KEY=your_openai_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key

# Linear OAuth App (from Linear developer dashboard)
LINEAR_CLIENT_ID=your_linear_client_id
LINEAR_CLIENT_SECRET=your_linear_client_secret
WEBHOOK_SIGNING_SECRET=your_linear_webhook_secret
REDIRECT_URI=https://your-domain.vercel.app/oauth/callback
WEBHOOK_URL=https://your-domain.vercel.app/webhook

# GitHub App (from GitHub developer settings)
GITHUB_APP_ID=your_github_app_id
GITHUB_APP_PRIVATE_KEY=your_github_app_private_key
GITHUB_APP_CLIENT_ID=your_github_app_client_id
GITHUB_APP_CLIENT_SECRET=your_github_app_client_secret
GITHUB_APP_INSTALLATION_ID=your_installation_id

# Slack App (from Slack API dashboard)
SLACK_BOT_TOKEN=xoxb-your-slack-bot-token
SLACK_SIGNING_SECRET=your_slack_signing_secret

# Storage (Required - create Upstash Redis instance)
KV_REST_API_URL=your_upstash_redis_url
KV_REST_API_TOKEN=your_upstash_redis_token

# Repository Configuration
REPO_BASE_BRANCH=main