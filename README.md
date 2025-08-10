# Otron

**An omnipresent open source AI agent that lives across your GitHub, Slack, and Linear workspaces.**

Otron is the new name for the gemini-cli, and now includes otron-pr-review, a new feature for automated pull request reviews.

Otron seamlessly integrates with your development workflow, automatically responding to webhooks and taking intelligent actions across all three platforms. Whether it's managing Linear issues, creating GitHub pull requests, or sending rich Slack messages, Otron acts as your autonomous development teammate.

## 🚀 Quick Deploy

Deploy Otron to Vercel with one click:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fotron-io%2Fotron&env=OPENAI_API_KEY,ANTHROPIC_API_KEY,LINEAR_CLIENT_ID,LINEAR_CLIENT_SECRET,WEBHOOK_SIGNING_SECRET,GITHUB_APP_ID,GITHUB_APP_PRIVATE_KEY,GITHUB_APP_CLIENT_ID,GITHUB_APP_CLIENT_SECRET,GITHUB_APP_INSTALLATION_ID,KV_REST_API_URL,KV_REST_API_TOKEN,REPO_BASE_BRANCH,ALLOWED_REPOSITORIES,ADMIN_PASSWORD,INTERNAL_API_TOKEN&envDescription=Required%20environment%20variables%20for%20Otron%20AI%20Agent&envLink=https%3A%2F%2Fgithub.com%2Fotron-io%2Fotron%23environment-variables&project-name=otron-ai-agent&repository-name=otron-ai-agent)

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
- **Automated Pull Request Reviews**: Provides AI-powered reviews on your pull requests.
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
ALLOWED_REPOSITORIES=owner/repo1,owner/repo2  # Optional: comma-separated list

# Admin Access & Security
ADMIN_PASSWORD=your_admin_interface_password  # Default: admin
INTERNAL_API_TOKEN=your_internal_api_token    # Default: internal-token

# Frontend Configuration (Optional)
FRONTEND_URL=https://your-frontend-domain.vercel.app

# Vercel Runtime (Auto-set by Vercel)
VERCEL_URL=https://your-domain.vercel.app
```

### Local Development

```bash
# Clone your fork
git clone https://github.com/otron-io/otron.git
cd otron

# Install dependencies
npm install

# Create .env file with your environment variables
cp .env.example .env
# Edit .env with your actual values

# Start development server
npm run dev

# Type checking
npm run check:types

# Linting and formatting
npm run fix
```

### Post-Deployment Setup

1. **Test the deployment**: Visit `https://your-domain.vercel.app/`
2. **Install Linear App**: Click "Install Linear Agent" and complete OAuth flow
3. **Install GitHub App**: Go to your GitHub App settings and install it on repositories
4. **Install Slack App**: Install your Slack app in your workspace
5. **Set up repository embeddings**: Visit `/pages/embed` to enable semantic code search

## 📖 Usage

### Getting Started

1. **Install Linear App**: Visit `https://your-domain.vercel.app/linear-app` and authorize
2. **Configure Slack App**: Install the Slack app in your workspace
3. **Install GitHub App**: Install the GitHub app on your repositories
4. **Access Dashboard**: Visit `https://otron.io/dashboard` for the main dashboard. User and server info is stored in your browser and is not sent to our servers
5. 5. **Set up repository embeddings**: Click the `Repository Embeddings` tile to add repos to the agent to work on and analyse

### Common Commands

#### Linear

```
@Otron analyze this issue
@Otron implement this feature
@Otron what's missing from this ticket?
@Otron create a technical spec
```

#### Slack

```
Hey @Otron, can you create a Linear issue for this bug?
@Otron what's the status of OTR-123?
@Otron send a summary to #engineering
```

### Advanced Features

#### Semantic Code Search

Otron uses vector embeddings to understand your codebase semantically:

```
@Otron find authentication-related code
@Otron show me error handling patterns
@Otron where is the user validation logic?
```

#### Multi-Repository Operations

Otron can work across multiple repositories simultaneously:

```
@Otron implement this API change across all microservices
@Otron update the shared component in all dependent repos
```

#### Interactive Slack Components

Otron creates rich, interactive messages with buttons and menus that you can click to trigger actions.

## 🔧 Configuration

### Repository Embedding

To enable semantic code search, embed your repositories:

1. Visit `https://otron.io/dashboard`
2. Click "Repository embeddings"
3. Enter repository names in `owner/repo` format
4. Click "Start Embedding" to process the codebase
5. Monitor progress and resume if timeout occurs

### Automated Re-embedding

For repositories that change frequently, you can set up automated re-embedding using GitHub Actions. This ensures your code embeddings stay up-to-date as your codebase evolves.

#### GitHub Actions Workflow Template

Create `.github/workflows/re-embed.yml` in your repository:

```yaml
name: Re-embed Repository

on:
  push:
    branches:
      - main
    paths:
      - '**/*.ts'
      - '**/*.tsx'
      - '**/*.js'
      - '**/*.jsx'
      - '**/*.vue'
      - '**/*.py'
      - '**/*.rb'
      - '**/*.java'
      - '**/*.php'
      - '**/*.go'
      - '**/*.rs'
      - '**/*.c'
      - '**/*.cpp'
      - '**/*.cs'
      - '**/*.swift'
      - '**/*.kt'
      - '**/*.scala'
      - '**/*.sh'
      - '**/*.pl'
      - '**/*.pm'
  workflow_dispatch:
    inputs:
      mode:
        description: 'Embedding mode'
        required: false
        default: 'diff'
        type: choice
        options:
          - diff
          - full

jobs:
  re-embed:
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0 # Fetch full history for diff comparison

      - name: Get repository name
        id: repo
        run: |
          REPO_NAME="${{ github.repository }}"
          echo "name=${REPO_NAME}" >> $GITHUB_OUTPUT
          echo "Repository: ${REPO_NAME}"

      - name: Determine embedding mode
        id: mode
        run: |
          if [[ "${{ github.event_name }}" == "workflow_dispatch" ]]; then
            MODE="${{ github.event.inputs.mode }}"
          else
            # For push events to main, use diff mode by default for efficiency
            MODE="diff"
          fi
          echo "mode=${MODE}" >> $GITHUB_OUTPUT
          echo "Embedding mode: ${MODE}"

      - name: Trigger repository re-embedding
        run: |
          echo "Triggering re-embedding for repository: ${{ steps.repo.outputs.name }}"
          echo "Mode: ${{ steps.mode.outputs.mode }}"

          RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
            "${{ secrets.OTRON_URL }}/api/embed-repo" \
            -H "Content-Type: application/json" \
            -d '{
              "repository": "${{ steps.repo.outputs.name }}",
              "mode": "${{ steps.mode.outputs.mode }}"
            }')

          HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
          BODY=$(echo "$RESPONSE" | head -n -1)

          echo "HTTP Status: $HTTP_CODE"
          echo "Response: $BODY"

          if [[ $HTTP_CODE -ge 200 && $HTTP_CODE -lt 300 ]]; then
            echo "✅ Re-embedding triggered successfully"
            
            # Log the mode being used for clarity
            if [[ "${{ steps.mode.outputs.mode }}" == "diff" ]]; then
              echo "🔄 Using diff-based embedding - only changed files will be processed"
            else
              echo "🔄 Using full embedding - all files will be processed"
            fi
          else
            echo "❌ Failed to trigger re-embedding"
            echo "Response body: $BODY"
            exit 1
          fi

      - name: Monitor embedding progress (optional)
        if: success()
        run: |
          echo "Re-embedding has been triggered. You can monitor progress at:"
          echo "${{ secrets.OTRON_URL }}/pages/embed"
          echo ""
          if [[ "${{ steps.mode.outputs.mode }}" == "diff" ]]; then
            echo "Note: Diff-based embedding will only process files that have changed since the last embedding."
            echo "If this is the first embedding for this repository, it will automatically fall back to full embedding."
          else
            echo "Note: Full embedding will process all files in the repository."
          fi
          echo "The embedding process runs asynchronously and may take several minutes to complete."
```

#### Setup Requirements

1. **Repository Secret**: Add `OTRON_URL` to your repository secrets:

   - Go to Repository Settings → Secrets and variables → Actions
   - Add new repository secret: `OTRON_URL` = `https://your-domain.vercel.app`

2. **File Types**: The workflow triggers on changes to common programming language files. Modify the `paths` section to match your repository's needs.

3. **Embedding Modes**:
   - **`diff` mode** (default): Only re-embeds files that have changed since the last embedding
   - **`full` mode**: Re-embeds all files in the repository

#### Benefits

- **Automatic Updates**: Embeddings stay current with code changes
- **Efficient Processing**: Diff mode only processes changed files
- **Manual Control**: Use workflow dispatch for full re-embedding when needed
- **Better Search Results**: Always search against the latest code structure

### Controlling Behavior

Use Linear labels to control Otron's behavior:

- `agent:implement` - Always implement code changes
- `agent:analysis-only` - Provide analysis without implementation
- `agent:urgent` - Prioritize this issue

### App Installation

Visit your deployment's dashboard to install and configure each platform integration:

- **Linear**: Click "Install Linear Agent" to begin OAuth flow
- **GitHub**: Install the GitHub App on your repositories
- **Slack**: Install the Slack app in your workspace channels

## 🔐 Security & Authentication

Otron implements multiple security layers:

- **OAuth Authorization**: Secure token-based authentication for all platforms
- **Webhook Verification**: Validates all incoming webhooks
- **Token-Based API Access**: Secures internal endpoints
- **Basic Authentication**: Protects admin interfaces
- **Scope Limitation**: Restricts repository access to allowed list

### Protected Endpoints

| Endpoint              | Access Level     | Description                   |
| --------------------- | ---------------- | ----------------------------- |
| `/webhook`            | Webhook Verified | Linear webhook receiver       |
| `/api/events`         | Webhook Verified | Slack event receiver          |
| `/api/code-search`    | Token Protected  | Semantic code search          |
| `/api/embed-repo`     | Token Protected  | Repository embedding API      |
| `/api/agent-monitor`  | Token Protected  | Agent monitoring API          |
| `/api/memory-browser` | Token Protected  | Memory management API         |
| `/oauth/callback`     | OAuth Flow       | Linear OAuth callback handler |
| `/pages/embed`        | Basic Auth       | Legacy embedding interface    |
| `/pages/agent`        | Basic Auth       | Legacy monitoring dashboard   |
| `/pages/dashboard`    | Basic Auth       | Legacy dashboard              |

## 🎛 Admin Dashboard

Access the admin dashboard at `https://otron.io/dashboard/` to:

- Monitor agent activity and performance
- View conversation history and context
- Manage repository embeddings
- Configure behavior and settings
- Install platform integrations
- Debug webhook deliveries

The dashboard includes:

- **Agent Monitor**: Real-time activity tracking and tool usage statistics
- **Repository Embeddings**: Code embedding management and search interface
- **Linear App Installation**: Easy OAuth setup for Linear integration
- **System Information**: Configuration status and health monitoring
- **Memory Browser**: Advanced interface for browsing, filtering, and managing agent memories

### Dashboard Features

#### Agent Monitor

- Real-time activity tracking and performance metrics
- Tool usage statistics and success rates
- Active and completed context management
- System activity feed and health monitoring

#### Repository Embeddings

- Code embedding management and status tracking
- Semantic search interface with advanced filtering
- Repository embedding progress monitoring
- Bulk embedding operations and cleanup tools

#### Memory Browser

- **Advanced Memory Search**: Filter memories by issue, type, date range, and content
- **Bulk Operations**: Delete multiple memories or cleanup old data
- **Memory Analytics**: View memory distribution and usage statistics
- **Issue-Specific Views**: Browse memories related to specific Linear issues or Slack threads
- **Content Preview**: Inspect memory content including conversations, actions, and context data
- **Pagination**: Efficient browsing of large memory datasets

The Memory Browser provides comprehensive visibility into Otron's memory system, allowing administrators to:

- Monitor memory usage and growth patterns
- Clean up outdated or irrelevant memories
- Debug agent behavior by examining memory context
- Understand conversation flow and decision-making patterns

## 🔍 Monitoring & Debugging

### Memory System

Otron maintains persistent memory:

- Conversation history across platforms
- Issue context and relationships
- Tool usage patterns and success rates
- Code knowledge and repository structure

### Goal Evaluation

Otron continuously evaluates its own performance:

- Assesses goal completion and confidence
- Adjusts strategies based on outcomes
- Retries failed operations with improved approaches
- Learns from user feedback and corrections

### Execution Strategy

Otron follows a structured execution approach:

1. **Planning**: Understand the request and create a plan
2. **Gathering**: Collect necessary information efficiently
3. **Acting**: Execute the plan with precise actions
4. **Completing**: Finalize and communicate results

## 🤝 Contributing

We welcome contributions from the community! Otron is designed to be extensible and we'd love your help making it even better.

### 🌟 Ways to Contribute

- **🐛 Bug Reports**: Found a bug? Please open an issue with detailed reproduction steps
- **💡 Feature Requests**: Have an idea? Open an issue to discuss it with the community
- **🔧 Code Contributions**: Submit pull requests for bug fixes, features, or improvements
- **📚 Documentation**: Help improve our docs, add examples, or fix typos
- **🧪 Testing**: Help us test new features and report issues
- **💬 Community Support**: Help answer questions in GitHub Discussions

### 🚀 Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/your-username/otron.git
   cd otron
   ```
3. **Install dependencies**:
   ```bash
   npm install
   ```
4. **Set up your development environment** (see Installation & Setup section)
5. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

### 🛠 Development Guidelines

#### Code Standards

- **TypeScript**: All code should be written in TypeScript with proper type definitions
- **ESLint**: Follow the existing ESLint configuration
- **Prettier**: Use Prettier for code formatting
- **Testing**: Add tests for new functionality when applicable

#### Architecture Principles

- **Modular Design**: Keep components focused and reusable
- **Error Handling**: Include comprehensive error handling and logging
- **Security**: Follow security best practices, especially for OAuth and webhooks
- **Performance**: Consider performance implications of new features

#### Pull Request Process

1. **Create a clear PR title** that describes the change
2. **Provide detailed description** of what your PR does and why
3. **Reference related issues** using `Closes #123` or `Fixes #123`
4. **Add tests** if you're adding new functionality
5. **Update documentation** if needed
6. **Ensure CI passes** - all tests and linting must pass

#### Code Review Guidelines

- **Be respectful** and constructive in reviews
- **Focus on the code**, not the person
- **Provide specific feedback** with suggestions for improvement
- **Ask questions** if something isn't clear
- **Approve** when the code meets our standards

### 🏗 Project Structure

```
otron/
├── api/                 # Vercel serverless functions
│   ├── webhook.ts      # Linear webhook handler
│   ├── events.ts       # Slack event handler
│   └── ...
├── lib/                # Core application logic
│   ├── generate-response.ts  # Main AI response logic
│   ├── tool-executors.ts     # Tool implementations
│   ├── memory/              # Memory management
│   └── ...
├── .github/workflows/   # GitHub Actions
└── README.md
```

### 🔧 Adding New Tools

Tools are the core of Otron's functionality. To add a new tool:

1. **Define the tool** in `lib/tool-executors.ts`
2. **Add proper TypeScript types** and validation
3. **Include error handling** and status updates
4. **Update the tool list** in `lib/generate-response.ts`
5. **Add documentation** and examples

Example tool structure:

```typescript
export const executeYourNewTool = async (
  params: { param1: string; param2: number },
  updateStatus?: (status: string) => void
) => {
  try {
    updateStatus?.('Executing your new tool...');

    // Your tool logic here

    return 'Success message';
  } catch (error) {
    console.error('Error in your new tool:', error);
    throw error;
  }
};
```

### 📋 Issue Labels

We use labels to organize issues:

- `bug` - Something isn't working
- `enhancement` - New feature or request
- `documentation` - Improvements to documentation
- `good first issue` - Good for newcomers
- `help wanted` - Extra attention is needed
- `question` - Further information is requested

### 🎯 Roadmap

Check our [GitHub Issues](https://github.com/otron-io/otron/issues) and [Discussions](https://github.com/otron-io/otron/discussions) for:

- Planned features and improvements
- Community feature requests
- Technical discussions
- Architecture decisions

### 📞 Community

- **GitHub Discussions**: For questions, ideas, and community chat
- **GitHub Issues**: For bug reports and feature requests
- **Discord**: [Join our Discord](https://discord.gg/otron) for real-time chat

### 📜 Code of Conduct

We are committed to providing a friendly, safe, and welcoming environment for all contributors. Please read and follow our [Code of Conduct](CODE_OF_CONDUCT.md).

### 🏆 Recognition

Contributors will be recognized in:

- README contributors section
- Release notes for significant contributions
- Special recognition for outstanding contributions

### ❓ Questions?

Don't hesitate to ask questions! You can:

- Open a GitHub Discussion
- Comment on relevant issues
- Join our Discord community

We're here to help and want you to succeed! 🚀

## 📄 License

Open source under the MIT License. See [LICENSE](LICENSE) for details.

## 🆘 Support

- **Documentation**: Check the `/pages/dashboard` for real-time help
- **Issues**: Report bugs and feature requests on GitHub
- **Community**: Join discussions in GitHub Discussions
- **Security**: Report security issues privately to maintainers

---

**Otron is more than just an AI agent—it's your autonomous development teammate that never sleeps, never forgets, and continuously learns to better serve your team.**
