import { Octokit } from '@octokit/rest';
import { Redis } from '@upstash/redis';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { env } from '../src/env.js';
import { GitHubAppService } from '../src/github-app.js';
import { withInternalAccess } from '../src/auth.js';

// Extend VercelResponse with flush method which may be available
interface EnhancedResponse extends VercelResponse {
  flush?: () => void;
}

// Set 13-minute maximum duration for Vercel functions
export const maxDuration = 780;

// Initialize Redis
const redis = new Redis({
  url: env.KV_REST_API_URL,
  token: env.KV_REST_API_TOKEN,
});

// Initialize GitHub App service
const githubAppService = GitHubAppService.getInstance();

// Code file extensions to process
const CODE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.vue',
  '.py',
  '.rb',
  '.java',
  '.php',
  '.go',
  '.rs',
  '.c',
  '.cpp',
  '.cs',
  '.swift',
  '.kt',
  '.scala',
  '.sh',
  '.pl',
  '.pm',
];

// Code file extensions mapped to their language
const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.vue': 'vue',
  '.py': 'python',
  '.rb': 'ruby',
  '.java': 'java',
  '.php': 'php',
  '.go': 'go',
  '.rs': 'rust',
  '.c': 'c',
  '.cpp': 'cpp',
  '.cs': 'csharp',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.scala': 'scala',
  '.sh': 'shell',
  '.pl': 'perl',
  '.pm': 'perl',
};

// Files to exclude
const EXCLUDED_DIRS = [
  'node_modules',
  'dist',
  'build',
  '.git',
  'vendor',
  '__pycache__',
  'coverage',
  'target',
  'bin',
  'obj',
  '.idea',
  '.vscode',
];

// Interface for code chunks
interface CodeChunk {
  repository: string;
  path: string;
  content: string;
  embedding?: number[];
  metadata: {
    language: string;
    type: 'function' | 'class' | 'method' | 'block' | 'file';
    name?: string;
    startLine: number;
    endLine: number;
    lineCount: number;
  };
}

// Interface for embedding checkpoint information
interface EmbeddingCheckpoint {
  repository: string;
  status: 'in_progress' | 'completed' | 'failed';
  startedAt: number;
  lastProcessedAt: number;
  processedFiles: number;
  totalFiles?: number;
  currentPath?: string;
  errors: string[];
  progress: number;
  lastCommitSha?: string;
}

// Redis key structure for embeddings
const getRepoKey = (repo: string) => `embedding:repo:${repo}:status`;
const getChunkKey = (repo: string) => `embedding:repo:${repo}:chunks`;
const getFileKey = (repo: string, path: string) =>
  `embedding:repo:${repo}:file:${path}`;
const getProcessedFilesKey = (repo: string) =>
  `embedding:repo:${repo}:processed_files`;

/**
 * Streams progress updates to the client
 */
function createJsonStream(res: EnhancedResponse) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  return {
    write: (data: any) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      // Use optional chaining for flush as it may not exist on all response objects
      res.flush?.();
    },
    end: () => {
      res.end();
    },
  };
}

/**
 * Get an Octokit client for a specific repository
 */
async function getOctokitForRepo(repository: string): Promise<Octokit> {
  if (githubAppService) {
    return await githubAppService.getOctokitForRepo(repository);
  }

  throw new Error('GitHub App service not initialized');
}

// Maximum tokens per embedding request
const MAX_TOKENS_PER_BATCH = 8000;

/**
 * Estimate the number of tokens in a text string
 * This is a simple heuristic and not a precise count
 */
function estimateTokenCount(text: string): number {
  // A rough approximation: 1 token ≈ 4 characters for English text
  return Math.ceil(text.length / 4);
}

/**
 * Use OpenAI API to generate embeddings for code chunks
 */
async function createEmbeddings(chunks: CodeChunk[]): Promise<CodeChunk[]> {
  if (chunks.length === 0) return [];

  const texts = chunks.map((chunk) => chunk.content);
  const results: CodeChunk[] = [];
  
  // Process in batches to avoid token limits
  let currentBatch: string[] = [];
  let currentBatchTokens = 0;
  let currentChunks: CodeChunk[] = [];
  
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    const chunk = chunks[i];
    const estimatedTokens = estimateTokenCount(text);
    
    // Skip chunks that are individually too large
    if (estimatedTokens > MAX_TOKENS_PER_BATCH) {
      console.warn(`Chunk is too large (${estimatedTokens} tokens) and exceeds limit: ${chunk.path}`);
      // Add the chunk without embedding
      results.push(chunk);
      continue;
    }
    
    // If adding this text would exceed the token limit, process the current batch
    if (currentBatchTokens + estimatedTokens > MAX_TOKENS_PER_BATCH) {
      // Process the current batch
      const batchResults = await processEmbeddingBatch(currentChunks, currentBatch);
      results.push(...batchResults);
      
      // Reset the batch
      currentBatch = [text];
      currentBatchTokens = estimatedTokens;
      currentChunks = [chunk];
    } else {
      // Add to current batch
      currentBatch.push(text);
      currentBatchTokens += estimatedTokens;
      currentChunks.push(chunk);
    }
  }
  
  // Process any remaining chunks
  if (currentBatch.length > 0) {
    const batchResults = await processEmbeddingBatch(currentChunks, currentBatch);
    results.push(...batchResults);
  }
  
  return results;
}

/**
 * Process a batch of texts to generate embeddings
 */
async function processEmbeddingBatch(chunks: CodeChunk[], texts: string[]): Promise<CodeChunk[]> {
  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: texts,
        dimensions: 256, // Reduced dimensionality for efficiency and cost
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`OpenAI API error: ${JSON.stringify(error)}`);
    }

    const result = await response.json();

    // Add embeddings to chunks
    return chunks.map((chunk, i) => ({
      ...chunk,
      embedding: result.data[i].embedding,
    }));
  } catch (error) {
    console.error('Error creating embeddings:', error);
    throw error;
  }
}

/**
 * Intelligently chunk a code file into semantic units
 */
function chunkCodeFile(
  repository: string,
  path: string,
  content: string
): CodeChunk[] {
  const extension = path.substring(path.lastIndexOf('.'));
  const language = LANGUAGE_MAP[extension] || 'plaintext';
  const lines = content.split('\n');

  // Simple chunking for now - we'll enhance this with AST parsing
  const chunks: CodeChunk[] = [];

  // Detect functions, classes, or methods
  let inFunction = false;
  let functionStart = 0;
  let currentFunction = '';
  let bracketCount = 0;

  // For non-curly bracket languages like Python
  let indentLevel = 0;
  let currentIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip empty lines and comments
    if (line.trim() === '' || line.trim().startsWith('//')) {
      continue;
    }

    // Check for function/class/method declarations
    const isFunctionStart =
      (language === 'typescript' || language === 'javascript') &&
      (/function\s+[\w$]+\s*\(/.test(line) || // function declaration
        /const\s+[\w$]+\s*=\s*function\s*\(/.test(line) || // function expression
        /const\s+[\w$]+\s*=\s*\(.*\)\s*=>/.test(line) || // arrow function
        /class\s+[\w$]+/.test(line) || // class declaration
        /[\w$.]+\.prototype\.[\w$]+\s*=\s*function/.test(line) || // prototype method
        /[\w$]+\s*\([^)]*\)\s*{/.test(line)); // method

    // Track bracket count to determine when a function/class ends
    if (line.includes('{')) {
      bracketCount += (line.match(/{/g) || []).length;
    }
    if (line.includes('}')) {
      bracketCount -= (line.match(/}/g) || []).length;
    }

    // For Python-like languages, track indentation
    if (language === 'python') {
      const indent = line.length - line.trimLeft().length;
      if (
        line.trimLeft().startsWith('def ') ||
        line.trimLeft().startsWith('class ')
      ) {
        // Start of a function or class in Python
        if (!inFunction) {
          inFunction = true;
          functionStart = i;
          currentFunction = line.trim();
          indentLevel = indent;
        }
      } else if (inFunction) {
        currentIndent = indent;
        // End of a function or class if we go back to the original indent level
        if (currentIndent <= indentLevel && i > functionStart + 1) {
          // Create a chunk for the function/class
          const functionCode = lines
            .slice(functionStart, i)
            .join('\n');
          chunks.push({
            repository,
            path,
            content: functionCode,
            metadata: {
              language,
              type: currentFunction.includes('class') ? 'class' : 'function',
              name: currentFunction
                .replace('def ', '')
                .replace('class ', '')
                .split('(')[0]
                .trim(),
              startLine: functionStart + 1,
              endLine: i,
              lineCount: i - functionStart,
            },
          });

          inFunction = false;
          i--; // Re-process the current line
        }
      }
    } else {
      // For curly-brace languages
      if (isFunctionStart && !inFunction) {
        inFunction = true;
        functionStart = i;
        currentFunction = line.trim();
      } else if (inFunction && bracketCount === 0) {
        // End of a function or class
        const functionCode = lines.slice(functionStart, i + 1).join('\n');
        chunks.push({
          repository,
          path,
          content: functionCode,
          metadata: {
            language,
            type: currentFunction.includes('class') ? 'class' : 'function',
            name: currentFunction
              .replace('function ', '')
              .replace('class ', '')
              .split('(')[0]
              .split('=')[0]
              .trim(),
            startLine: functionStart + 1,
            endLine: i + 1,
            lineCount: i - functionStart + 1,
          },
        });

        inFunction = false;
      }
    }
  }

  // If there are no functions/classes or some code outside of functions,
  // add the remaining code as separate chunks in blocks of suitable size
  if (chunks.length === 0 || chunks.some((c) => c.metadata.lineCount < lines.length)) {
    // Create chunks of approximately 50-100 lines each
    const BLOCK_SIZE = 100;
    let currentBlock: string[] = [];
    let blockStart = 0;

    // Skip lines that are already in chunks
    const chunkedLines = new Set<number>();
    chunks.forEach((chunk) => {
      for (
        let line = chunk.metadata.startLine - 1;
        line < chunk.metadata.endLine;
        line++
      ) {
        chunkedLines.add(line);
      }
    });

    // Create blocks for unchunked lines
    for (let i = 0; i < lines.length; i++) {
      if (!chunkedLines.has(i)) {
        if (currentBlock.length === 0) {
          blockStart = i;
        }
        currentBlock.push(lines[i]);

        // When we reach the desired block size or the end of the file,
        // create a chunk for this block
        if (
          currentBlock.length >= BLOCK_SIZE ||
          i === lines.length - 1
        ) {
          chunks.push({
            repository,
            path,
            content: currentBlock.join('\n'),
            metadata: {
              language,
              type: 'block',
              startLine: blockStart + 1,
              endLine: i + 1,
              lineCount: currentBlock.length,
            },
          });
          currentBlock = [];
        }
      }
    }
  }

  // If the file is very small, just include the whole file as one chunk
  if (chunks.length === 0 && lines.length <= BLOCK_SIZE) {
    chunks.push({
      repository,
      path,
      content,
      metadata: {
        language,
        type: 'file',
        startLine: 1,
        endLine: lines.length,
        lineCount: lines.length,
      },
    });
  }

  return chunks;
}

/**
 * Check if a file should be excluded based on its path
 */
function shouldExcludeFile(path: string): boolean {
  // Skip excluded directories
  if (EXCLUDED_DIRS.some((dir) => path.includes(`/${dir}/`))) {
    return true;
  }

  // Skip files without a relevant extension
  const extension = path.substring(path.lastIndexOf('.'));
  if (!CODE_EXTENSIONS.includes(extension)) {
    return true;
  }

  return false;
}

/**
 * Recursively list files in a repository
 */
async function listFiles(octokit: Octokit, repository: string): Promise<string[]> {
  const [owner, repo] = repository.split('/');
  const files: string[] = [];

  // Get the default branch
  const { data: repoData } = await octokit.repos.get({ owner, repo });
  const branch = repoData.default_branch;

  // Get the root tree
  const { data: commit } = await octokit.repos.getCommit({
    owner,
    repo,
    ref: branch,
  });

  // Store the commit SHA for later
  const commitSha = commit.sha;

  // Get the root tree
  const { data: rootTree } = await octokit.git.getTree({
    owner,
    repo,
    tree_sha: commit.commit.tree.sha,
    recursive: '1',
  });

  // Filter for code files and exclude binary files
  for (const item of rootTree.tree) {
    if (item.type === 'blob' && item.path && !shouldExcludeFile(item.path)) {
      files.push(item.path);
    }
  }

  return files;
}

/**
 * Processes a repository's code files and creates embeddings
 */
async function processRepository(
  octokit: Octokit,
  repository: string,
  stream: ReturnType<typeof createJsonStream>,
  resume: boolean = false
): Promise<void> {
  const [owner, repo] = repository.split('/');
  let checkpoint: EmbeddingCheckpoint | null = null;

  // Check for existing checkpoint
  if (resume) {
    const checkpointStr = await redis.get(getRepoKey(repository));
    if (checkpointStr) {
      try {
        checkpoint = JSON.parse(checkpointStr);
        if (checkpoint.status === 'completed') {
          stream.write({
            status: 'success',
            message: 'Repository already fully embedded',
            repository,
            progress: 100,
            checkpoint,
          });
          return;
        } else if (checkpoint.status === 'in_progress') {
          stream.write({
            status: 'info',
            message: `Resuming from checkpoint (${checkpoint.processedFiles} files processed)`,
            progress: checkpoint.progress,
            checkpoint,
          });
        }
      } catch (error) {
        console.error('Error parsing checkpoint:', error);
        checkpoint = null;
      }
    }
  }

  // Initialize checkpoint if needed
  if (!checkpoint) {
    checkpoint = {
      repository,
      status: 'in_progress',
      startedAt: Date.now(),
      lastProcessedAt: Date.now(),
      processedFiles: 0,
      errors: [],
      progress: 0,
    };
  }

  try {
    // Get the list of files
    stream.write({
      status: 'info',
      message: 'Listing repository files...',
      progress: checkpoint.progress,
    });

    const files = await listFiles(octokit, repository);
    checkpoint.totalFiles = files.length;

    // Get already processed files from Redis
    let processedFilesSet = new Set<string>();
    if (resume && checkpoint.processedFiles > 0) {
      const processedFiles = await redis.smembers(
        getProcessedFilesKey(repository)
      );
      processedFilesSet = new Set(processedFiles);
      stream.write({
        status: 'info',
        message: `Found ${processedFilesSet.size} previously processed files`,
        progress: checkpoint.progress,
      });
    }

    // Calculate progress increment per file
    const progressIncrement = 100 / files.length;

    // Process each file
    for (const filePath of files) {
      // Skip already processed files when resuming
      if (processedFilesSet.has(filePath)) {
        continue;
      }

      checkpoint.currentPath = filePath;
      stream.write({
        status: 'info',
        message: `Processing ${filePath}`,
        progress: checkpoint.progress,
        currentFile: filePath,
      });

      try {
        // Get file content
        const { data } = await octokit.repos.getContent({
          owner,
          repo,
          path: filePath,
        });

        if ('content' in data && 'encoding' in data) {
          // Decode base64 content
          const content = Buffer.from(data.content, 'base64').toString('utf-8');

          // Skip empty files
          if (!content.trim()) {
            continue;
          }

          // Chunk and create embeddings
          const chunks = chunkCodeFile(repository, filePath, content);
          const embeddedChunks = await createEmbeddings(chunks);

          // Store embeddings in Redis
          for (const chunk of embeddedChunks) {
            if (chunk.embedding) {
              // Store the chunk with embedding
              await redis.zadd(
                getChunkKey(repository),
                { score: 1, member: JSON.stringify(chunk) }
              );
            }
          }

          // Mark file as processed
          await redis.sadd(getProcessedFilesKey(repository), filePath);
          checkpoint.processedFiles++;
          checkpoint.progress += progressIncrement;
          checkpoint.lastProcessedAt = Date.now();
        }
      } catch (error) {
        // Log error but continue with next file
        console.error(`Error processing ${filePath}:`, error);
        checkpoint.errors.push(
          `Error processing ${filePath}: ${(error as Error).message}`
        );

        stream.write({
          status: 'warning',
          message: `Error processing ${filePath}: ${(error as Error).message}`,
          progress: checkpoint.progress,
        });
      }

      // Update checkpoint
      await redis.set(
        getRepoKey(repository),
        JSON.stringify(checkpoint),
        {
          ex: 60 * 60 * 24 * 7, // 1 week expiry
        }
      );
    }

    // Mark as completed
    checkpoint.status = 'completed';
    checkpoint.progress = 100;
    checkpoint.lastProcessedAt = Date.now();
    await redis.set(getRepoKey(repository), JSON.stringify(checkpoint), {
      ex: 60 * 60 * 24 * 30, // 30 days expiry for completed embeddings
    });

    stream.write({
      status: 'success',
      message: `Completed embedding ${checkpoint.processedFiles} files`,
      progress: 100,
      checkpoint,
    });
  } catch (error) {
    // Handle errors during processing
    console.error('Error processing repository:', error);
    checkpoint.status = 'failed';
    checkpoint.errors.push(`Repository error: ${(error as Error).message}`);
    await redis.set(getRepoKey(repository), JSON.stringify(checkpoint), {
      ex: 60 * 60 * 24 * 7, // 1 week expiry
    });

    stream.write({
      status: 'error',
      message: `Failed to process repository: ${(error as Error).message}`,
      progress: checkpoint.progress,
      checkpoint,
    });
  }
}

/**
 * API endpoint to start repository embedding
 */
export default withInternalAccess(async function handler(
  req: VercelRequest,
  res: EnhancedResponse
) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate request body
  if (!req.body || !req.body.repository) {
    return res.status(400).json({ error: 'Repository name is required' });
  }

  const { repository, resume = false } = req.body;

  try {
    // Create Octokit client
    const octokit = await getOctokitForRepo(repository);

    // Create JSON stream
    const stream = createJsonStream(res);

    // Process repository in the background
    processRepository(octokit, repository, stream, resume).catch((error) => {
      console.error('Error in background processing:', error);
      stream.write({
        status: 'error',
        message: `Background processing error: ${error.message}`,
      });
      stream.end();
    });
  } catch (error) {
    console.error('Error setting up embedding:', error);
    return res.status(500).json({ error: `Setup error: ${(error as Error).message}` });
  }
});
