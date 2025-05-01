# Code Repository Embeddings for Linear Agent

## Problem and Solution Overview

The Linear Agent relies heavily on GitHub's API to search and analyze repositories, but frequently hits rate limits, causing errors and timeouts in the agent's functionality.

We've implemented a vector embedding solution that:

1. **Indexes repositories**: Creates semantic embeddings of code chunks
2. **Stores in database**: Uses Upstash Redis for persistent storage
3. **Enables semantic search**: Performs cosine similarity matching
4. **Falls back gracefully**: Uses GitHub API only when repositories aren't embedded

This feature improves the Linear Agent's ability to search and understand code without hitting GitHub API rate limits.

## Key Components

### 1. Repository Embedding API (`/api/embed-repo.ts`)

- Fetches repository content via GitHub API
- Intelligently chunks code into semantic units
- Generates embeddings using OpenAI's embedding API
- Implements checkpoint system for resumable processing
- Streams progress updates to the client
- Handles timeouts gracefully (13-minute limit)

### 2. Vector Search API (`/api/code-search.ts`)

- Converts search queries to vector embeddings
- Performs similarity search against stored code chunks
- Ranks results by relevance
- Applies file filters when needed

### 3. Management UI (`/api/embed-ui.ts`)

- Provides a simple interface for repository indexing
- Shows embedding progress and logs
- Enables searching embedded repositories
- Displays repository status and statistics

### 4. Repository Manager Integration

- Automatically detects when repositories are embedded
- Uses vector search instead of GitHub API when available
- Falls back to GitHub API for non-embedded repositories
- Maintains consistent result format

## Benefits

- **No rate limits**: Search your code repositories without hitting GitHub API limits
- **Better semantic understanding**: More accurate code search results
- **Resumable processing**: Long-running embedding processes can be checkpointed and resumed
- **Faster responses**: Searches are much faster when using the embedding database
- **Scalable**: Works with repositories of any size through incremental indexing

## Usage

### Embedding a Repository

1. Visit `/api/embed-ui` to access the embedding UI
2. Enter the repository name in `owner/repo` format (e.g., `username/repository`)
3. Click "Start Embedding"
4. The process will run for up to 13 minutes, creating checkpoints as it progresses
5. If the process doesn't complete, you can resume it by clicking "Start Embedding" again

### Searching Embedded Repositories

The Linear Agent will automatically use the embedding-based search when available. When a repository has been embedded, all semantic code searches will use the vector database instead of the GitHub API.

You can also manually search embedded repositories:

1. Use the search interface in `/api/embed-ui`
2. Select an embedded repository
3. Enter a semantic search query
4. Optionally add a file filter to narrow results
5. View the search results with relevance scores

### API Endpoints

- `POST /api/embed-repo`: Start or resume embedding a repository

  ```json
  {
    "repository": "owner/repo",
    "resume": true
  }
  ```

- `GET /api/code-search`: Search embedded repositories
  ```
  /api/code-search?repository=owner/repo&query=search%20term&fileFilter=src/
  ```

## Technical Implementation Details

### Intelligent Code Chunking

We chunk code files by:

- Detecting functions, classes, and methods
- Preserving context and structure
- Creating semantically meaningful units

### Vector Embedding

We use OpenAI's `text-embedding-3-small` model with:

- 256 dimensions for efficiency and cost
- Batch processing to optimize API usage
- Consistent embedding space for queries and code

### Cosine Similarity Search

Our search algorithm:

- Calculates cosine similarity between query and all code chunks
- Applies a relevance threshold (0.7) to filter results
- Ranks by similarity score
- Returns top N results

### Checkpoint System

Our checkpoint mechanism:

- Tracks progress at file-level granularity
- Stores file processing state in Redis
- Enables resuming from the last processed file
- Maintains error logs for troubleshooting

### Embedding Process

The embedding process works by:

1. Listing all code files in the repository
2. Parsing each file into semantic chunks (functions, classes, methods)
3. Generating vector embeddings for each chunk using OpenAI's `text-embedding-3-small` model
4. Storing these embeddings in Upstash Redis

### Resumable Processing

The embedding process creates checkpoints that track:

- Which files have been processed
- Current progress percentage
- Any errors encountered

If the process times out (Vercel functions have a 13-minute limit), you can resume from the last checkpoint.

## Environment Variables

The following environment variables are required:

- `GITHUB_TOKEN`: A GitHub personal access token with repo scope (or GitHub App authentication)
- `OPENAI_API_KEY`: An OpenAI API key for generating embeddings
- `KV_REST_API_URL` and `KV_REST_API_TOKEN`: Upstash Redis credentials

## Deployment Requirements

- Vercel for serverless functions
- Upstash Redis for vector storage
- OpenAI API key for embedding generation
- GitHub token or GitHub App for initial repository access

## Troubleshooting

- **Rate limits**: If you encounter rate limits with the GitHub API, wait a few minutes before resuming the embedding process
- **Timeouts**: Large repositories may require multiple resume sessions to complete
- **Missing results**: Try different search terms or use broader queries

## Future Improvements

Potential enhancements:

1. Language-specific code parsers for better chunking
2. Automated re-indexing on repository changes
3. Batch embedding process using background workers
4. Compression techniques for embedding storage efficiency
5. Hybrid search combining keyword and semantic approaches

## License

This code is part of the Linear Agent project. See the main LICENSE file for details.
