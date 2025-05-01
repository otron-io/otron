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

/**
 * Use OpenAI API to generate embeddings for code chunks
 */
async function createEmbeddings(chunks: CodeChunk[]): Promise<CodeChunk[]> {
  if (chunks.length === 0) return [];

  const texts = chunks.map((chunk) => chunk.content);

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

  // Detect functions, classes and methods using regex patterns
  // This is a simplified approach - ideally we'd use language-specific parsers
  const functionPattern = /(?:function|def|fun|func|fn)\s+(\w+)\s*\(/g;
  const methodPattern =
    /(?:public|private|protected)?\s*(?:static)?\s*(?:async)?\s*(?:function)?\s*(\w+)\s*\(/g;
  const classPattern = /(?:class|interface|trait|struct|enum)\s+(\w+)/g;

  // Track blocks of code
  let currentBlock: {
    type: 'function' | 'class' | 'method' | 'block' | 'file';
    name?: string;
    startLine: number;
    endLine?: number;
    content: string[];
  } | null = null;

  // Process line by line
  let openBraces = 0;
  let hasStartedBlock = false;

  // Handle files without clear functions/classes as a single chunk
  if (
    !functionPattern.test(content) &&
    !classPattern.test(content) &&
    !methodPattern.test(content)
  ) {
    return [
      {
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
      },
    ];
  }

  // Reset regex
  functionPattern.lastIndex = 0;
  classPattern.lastIndex = 0;
  methodPattern.lastIndex = 0;

  // Process line by line with context
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for the start of a new block
    let match: RegExpExecArray | null;

    functionPattern.lastIndex = 0;
    if ((match = functionPattern.exec(line)) !== null && !currentBlock) {
      currentBlock = {
        type: 'function',
        name: match[1],
        startLine: i + 1,
        content: [line],
      };
      hasStartedBlock = true;
      openBraces +=
        (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
      continue;
    }

    classPattern.lastIndex = 0;
    if ((match = classPattern.exec(line)) !== null && !currentBlock) {
      currentBlock = {
        type: 'class',
        name: match[1],
        startLine: i + 1,
        content: [line],
      };
      hasStartedBlock = true;
      openBraces +=
        (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
      continue;
    }

    methodPattern.lastIndex = 0;
    if ((match = methodPattern.exec(line)) !== null && !currentBlock) {
      currentBlock = {
        type: 'method',
        name: match[1],
        startLine: i + 1,
        content: [line],
      };
      hasStartedBlock = true;
      openBraces +=
        (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
      continue;
    }

    // If we're inside a block, add the line
    if (currentBlock) {
      currentBlock.content.push(line);

      // Update brace count
      openBraces +=
        (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;

      // Check if the block is complete
      if (hasStartedBlock && openBraces <= 0) {
        // Save the current block
        currentBlock.endLine = i + 1;
        chunks.push({
          repository,
          path,
          content: currentBlock.content.join('\n'),
          metadata: {
            language,
            type: currentBlock.type,
            name: currentBlock.name,
            startLine: currentBlock.startLine,
            endLine: currentBlock.endLine,
            lineCount: currentBlock.endLine - currentBlock.startLine + 1,
          },
        });

        // Reset
        currentBlock = null;
        hasStartedBlock = false;
        openBraces = 0;
      }
    }
  }

  // Handle any remaining block
  if (currentBlock) {
    currentBlock.endLine = lines.length;
    chunks.push({
      repository,
      path,
      content: currentBlock.content.join('\n'),
      metadata: {
        language,
        type: currentBlock.type,
        name: currentBlock.name,
        startLine: currentBlock.startLine,
        endLine: currentBlock.endLine!,
        lineCount: currentBlock.endLine! - currentBlock.startLine + 1,
      },
    });
  }

  // If no chunks were created, create a single chunk for the whole file
  if (chunks.length === 0) {
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
 * Get all code files from a repository recursively
 */
async function listAllCodeFiles(
  repository: string,
  path: string = ''
): Promise<string[]> {
  const [owner, repo] = repository.split('/');
  const files: string[] = [];

  try {
    // Get octokit client for this repository
    const octokit = await getOctokitForRepo(repository);

    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path,
    });

    if (Array.isArray(data)) {
      for (const item of data) {
        // Skip excluded directories
        if (item.type === 'dir' && !EXCLUDED_DIRS.includes(item.name)) {
          const subFiles = await listAllCodeFiles(repository, item.path);
          files.push(...subFiles);
        } else if (item.type === 'file') {
          const extension = item.name.substring(item.name.lastIndexOf('.'));
          if (CODE_EXTENSIONS.includes(extension)) {
            files.push(item.path);
          }
        }
      }
    }

    return files;
  } catch (error) {
    console.error(`Error listing files in ${repository}:${path}:`, error);
    return [];
  }
}

/**
 * Process a single file into chunks and store embeddings
 */
async function processFile(
  repository: string,
  path: string,
  checkpoint: EmbeddingCheckpoint,
  stream: ReturnType<typeof createJsonStream>
): Promise<boolean> {
  try {
    console.log(`Processing file ${repository}:${path}`);

    // Check if file has already been processed - we're now handling this at the loop level
    // so this is just a safety check
    const isProcessed = await redis.sismember(
      getProcessedFilesKey(repository),
      path
    );
    if (isProcessed) {
      console.log(`File ${path} is already marked as processed, skipping`);
      stream.write({
        type: 'log',
        message: `Skipping already processed file: ${path}`,
      });
      return true;
    }

    // Update checkpoint with current file
    checkpoint.currentPath = path;
    await redis.set(getRepoKey(repository), JSON.stringify(checkpoint));

    // Get octokit client for this repository
    const octokit = await getOctokitForRepo(repository);

    // Get file content
    console.log(`Fetching content for ${repository}:${path}`);
    const [owner, repo] = repository.split('/');

    try {
      const { data } = await octokit.repos.getContent({
        owner,
        repo,
        path,
      });

      if ('content' in data && data.encoding === 'base64') {
        const content = Buffer.from(data.content, 'base64').toString('utf-8');
        console.log(`Fetched content for ${path}, ${content.length} bytes`);

        // Skip empty files
        if (!content.trim()) {
          await redis.sadd(getProcessedFilesKey(repository), path);
          stream.write({ type: 'log', message: `Skipped empty file: ${path}` });
          return true;
        }

        // Split file into chunks
        const chunks = chunkCodeFile(repository, path, content);
        console.log(`Split ${path} into ${chunks.length} chunks`);
        stream.write({
          type: 'log',
          message: `Processing ${path}: Split into ${chunks.length} semantic chunks`,
        });

        // Create embeddings for chunks
        if (chunks.length > 0) {
          // Process in batches to avoid token limits (16 chunks at a time)
          const BATCH_SIZE = 16;
          for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
            const batch = chunks.slice(i, i + BATCH_SIZE);
            const chunksWithEmbeddings = await createEmbeddings(batch);

            // Store chunks in Redis
            for (const chunk of chunksWithEmbeddings) {
              await redis.lpush(getChunkKey(repository), JSON.stringify(chunk));
              console.log(
                `Stored chunk for ${repository} - type: ${typeof chunk}, length: ${
                  JSON.stringify(chunk).length
                }`
              );
              if (i === 0) {
                console.log(
                  `Sample chunk stored: ${JSON.stringify(chunk).substring(
                    0,
                    200
                  )}...`
                );
              }
            }

            stream.write({
              type: 'progress',
              message: `Embedded batch ${
                Math.floor(i / BATCH_SIZE) + 1
              }/${Math.ceil(chunks.length / BATCH_SIZE)} of ${path}`,
            });
          }
        }

        // Mark file as processed
        await redis.sadd(getProcessedFilesKey(repository), path);
        stream.write({
          type: 'log',
          message: `Completed processing file: ${path}`,
        });

        return true;
      } else {
        throw new Error(`Unexpected file data format for ${path}`);
      }
    } catch (error) {
      console.error(`Error processing file ${path}:`, error);
      checkpoint.errors.push(`Error processing ${path}: ${error}`);
      await redis.set(getRepoKey(repository), JSON.stringify(checkpoint));
      stream.write({
        type: 'error',
        message: `Error processing ${path}: ${error}`,
      });
      return false;
    }
  } catch (error) {
    console.error(`Error processing file ${path}:`, error);
    checkpoint.errors.push(`Global error: ${error}`);
    await redis.set(getRepoKey(repository), JSON.stringify(checkpoint));
    stream.write({
      type: 'error',
      message: `Failed to process file: ${error}`,
    });
    return false;
  }
}

/**
 * Main handler for the embedding endpoint
 */
async function handler(req: VercelRequest, res: VercelResponse) {
  // Check if this is a delete request
  if (req.method === 'DELETE') {
    const { repository } = req.query;

    if (!repository || typeof repository !== 'string') {
      return res
        .status(400)
        .json({ error: 'Missing or invalid repository parameter' });
    }

    try {
      console.log(`Deleting repository ${repository} from Redis`);

      // List all processed files to get keys to delete
      const processedFiles = await redis.smembers(
        getProcessedFilesKey(repository)
      );

      // Delete all file-specific keys
      for (const filePath of processedFiles) {
        await redis.del(getFileKey(repository, filePath));
      }

      // Delete all repository-level keys
      await redis.del(getRepoKey(repository));
      await redis.del(getChunkKey(repository));
      await redis.del(getProcessedFilesKey(repository));

      return res.status(200).json({
        success: true,
        message: `Repository ${repository} has been completely deleted from the embedding system`,
      });
    } catch (error) {
      console.error(`Error deleting repository ${repository}:`, error);
      return res.status(500).json({
        error: `Failed to delete repository: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  }

  // Original POST handler for embedding
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { repository, resume = false, mode = 'full' } = req.body;

  if (!repository || typeof repository !== 'string') {
    return res
      .status(400)
      .json({ error: 'Missing or invalid repository parameter' });
  }

  // Setup streaming response
  const stream = createJsonStream(res as EnhancedResponse);

  try {
    // Get latest commit SHA for the repository
    const latestCommitSha = await getLatestCommitSha(repository);

    // Check if there's an existing checkpoint
    let checkpoint: EmbeddingCheckpoint;
    const existingCheckpoint = await redis.get(getRepoKey(repository));
    let filesToProcess: string[] = [];
    let isDiffMode = mode === 'diff';

    if (existingCheckpoint && (resume || isDiffMode)) {
      console.log(
        `Found existing checkpoint for ${repository}, type: ${typeof existingCheckpoint}`
      );
      console.log(`Resume: ${resume}, isDiffMode: ${isDiffMode}`);

      // Handle string representation issue
      if (existingCheckpoint === '[object Object]') {
        console.error(
          `Invalid repository status format for ${repository}: got '[object Object]' string`
        );
        stream.write({
          type: 'error',
          message: `Repository status data is corrupted. Starting fresh embedding.`,
        });
        // Create new checkpoint
        checkpoint = {
          repository,
          status: 'in_progress',
          startedAt: Date.now(),
          lastProcessedAt: Date.now(),
          processedFiles: 0,
          errors: [],
          progress: 0,
          lastCommitSha: latestCommitSha,
        };
      } else {
        try {
          // Parse checkpoint based on type
          if (typeof existingCheckpoint === 'object') {
            checkpoint = existingCheckpoint as unknown as EmbeddingCheckpoint;
            console.log(`Using existing checkpoint object for ${repository}`);
          } else {
            const checkpointStr = existingCheckpoint as string;
            console.log(
              `Parsing checkpoint string for ${repository}: ${checkpointStr.substring(
                0,
                100
              )}...`
            );
            checkpoint = JSON.parse(checkpointStr);
          }

          console.log(
            `Loaded checkpoint for ${repository}: status=${checkpoint.status}, progress=${checkpoint.progress}%, processedFiles=${checkpoint.processedFiles}`
          );
        } catch (error) {
          console.error(`Error parsing checkpoint for ${repository}:`, error);
          stream.write({
            type: 'error',
            message: `Error parsing checkpoint: ${error}. Starting fresh embedding.`,
          });
          // Create new checkpoint on error
          checkpoint = {
            repository,
            status: 'in_progress',
            startedAt: Date.now(),
            lastProcessedAt: Date.now(),
            processedFiles: 0,
            errors: [],
            progress: 0,
            lastCommitSha: latestCommitSha,
          };
        }
      }

      // If doing a diff, check if we have a commit to compare against
      if (
        isDiffMode &&
        checkpoint.status === 'completed' &&
        checkpoint.lastCommitSha
      ) {
        stream.write({
          type: 'diff',
          message: `Performing diff-based update for ${repository} from commit ${checkpoint.lastCommitSha.substring(
            0,
            7
          )} to ${latestCommitSha.substring(0, 7)}`,
        });

        // Get changed files between commits
        filesToProcess = await getChangedFiles(
          repository,
          checkpoint.lastCommitSha,
          latestCommitSha
        );

        if (filesToProcess.length === 0) {
          stream.write({
            type: 'complete',
            message: `No code files changed since last embedding. Repository is up to date.`,
            repository,
            totalChunks: await redis.llen(getChunkKey(repository)),
            totalFiles: 0,
            skippedFiles: 0,
            duration: 0,
          });
          stream.end();
          return;
        }

        stream.write({
          type: 'log',
          message: `Found ${filesToProcess.length} changed files to process`,
        });

        // Remove old chunks for changed files
        stream.write({
          type: 'log',
          message: `Removing old chunks for changed files...`,
        });
        await removeFileChunks(repository, filesToProcess);

        // Create new checkpoint for diff update
        checkpoint = {
          repository,
          status: 'in_progress',
          startedAt: Date.now(),
          lastProcessedAt: Date.now(),
          processedFiles: 0,
          errors: [],
          progress: 0,
          totalFiles: filesToProcess.length,
          lastCommitSha: latestCommitSha, // Set new commit SHA
        };
      } else if (resume && checkpoint.status === 'in_progress') {
        stream.write({
          type: 'resume',
          message: `Resuming embedding for ${repository} from ${checkpoint.processedFiles} files`,
        });

        // Force full mode when resuming
        isDiffMode = false;
      } else {
        // Start fresh
        isDiffMode = false;
        checkpoint = {
          repository,
          status: 'in_progress',
          startedAt: Date.now(),
          lastProcessedAt: Date.now(),
          processedFiles: 0,
          errors: [],
          progress: 0,
          lastCommitSha: latestCommitSha,
        };

        stream.write({
          type: 'log',
          message: `Starting fresh embedding for ${repository}`,
        });

        // Reset processed files tracking for a fresh start
        await redis.del(getProcessedFilesKey(repository));
        if (!resume) {
          await redis.del(getChunkKey(repository));
        }
      }
    } else {
      // Create new checkpoint - fresh start
      checkpoint = {
        repository,
        status: 'in_progress',
        startedAt: Date.now(),
        lastProcessedAt: Date.now(),
        processedFiles: 0,
        errors: [],
        progress: 0,
        lastCommitSha: latestCommitSha,
      };

      // Reset processed files tracking
      await redis.del(getProcessedFilesKey(repository));
      if (!resume) {
        await redis.del(getChunkKey(repository));
      }

      stream.write({
        type: 'log',
        message: `Starting fresh embedding for ${repository}`,
      });

      // Force full mode for fresh start
      isDiffMode = false;
    }

    // Update checkpoint in Redis
    await redis.set(getRepoKey(repository), JSON.stringify(checkpoint));

    // If not in diff mode, get all files to process
    if (!isDiffMode || filesToProcess.length === 0) {
      stream.write({
        type: 'log',
        message: `Listing all code files in ${repository}...`,
      });
      filesToProcess = await listAllCodeFiles(repository);
    }

    checkpoint.totalFiles = filesToProcess.length;

    // Update checkpoint with total files
    await redis.set(getRepoKey(repository), JSON.stringify(checkpoint));

    stream.write({
      type: 'log',
      message: `Found ${filesToProcess.length} code files to process in ${repository}`,
    });

    // Process each file
    let processed = 0;
    let skipped = 0;
    if (resume && checkpoint.processedFiles > 0 && !isDiffMode) {
      processed = checkpoint.processedFiles;
      stream.write({
        type: 'log',
        message: `Resuming from checkpoint: Starting at file ${processed} of ${filesToProcess.length}`,
      });
    }

    // Start processing from where we left off
    const MAX_RUNTIME_MS = 750000; // 12.5 minutes max to allow for cleanup
    const startTime = Date.now();

    // Get list of already processed files to avoid dependency on the processed counter
    const processedFilesSet = new Set(
      await redis.smembers(getProcessedFilesKey(repository))
    );
    stream.write({
      type: 'log',
      message: `Found ${processedFilesSet.size} already processed files in the set`,
    });

    // Update the processed files count from the actual set
    processed = processedFilesSet.size;

    // Update progress to reflect actual processed files
    let currentProgress = Math.floor((processed / filesToProcess.length) * 100);
    stream.write({
      type: 'progress',
      progress: currentProgress,
      processedFiles: processed,
      totalFiles: filesToProcess.length,
    });

    for (let i = 0; i < filesToProcess.length; i++) {
      // Check if we should process this file or skip (if resuming)
      if (resume && !isDiffMode) {
        // Skip if file is already in the processed set
        if (processedFilesSet.has(filesToProcess[i])) {
          skipped++;

          // Log skipped files occasionally for debugging
          if (skipped % 100 === 0 || skipped === 1) {
            stream.write({
              type: 'log',
              message: `Skipped ${skipped} already processed files so far. Current: ${filesToProcess[i]}`,
            });
          }
          continue;
        }
      }

      // Check if we're approaching the Vercel function timeout
      if (Date.now() - startTime > MAX_RUNTIME_MS) {
        stream.write({
          type: 'timeout',
          message: `Function nearing timeout, checkpointing after processing ${i} of ${filesToProcess.length} files`,
        });

        // Update checkpoint for resuming later
        checkpoint.lastProcessedAt = Date.now();
        checkpoint.processedFiles = i;
        checkpoint.progress = Math.floor((i / filesToProcess.length) * 100);
        await redis.set(getRepoKey(repository), JSON.stringify(checkpoint));

        // Return checkpoint info to client
        stream.write({
          type: 'checkpoint',
          checkpoint: {
            repository,
            processedFiles: i,
            totalFiles: filesToProcess.length,
            progress: Math.floor((i / filesToProcess.length) * 100),
            resumeUrl: `/api/embed-repo?repository=${repository}&resume=true`,
          },
        });

        stream.end();
        return;
      }

      // Process the file
      const success = await processFile(
        repository,
        filesToProcess[i],
        checkpoint,
        stream
      );

      if (success) {
        processed++;
        checkpoint.processedFiles = processed;
        checkpoint.progress = Math.floor(
          (processed / filesToProcess.length) * 100
        );

        if (i % 10 === 0 || i === filesToProcess.length - 1) {
          checkpoint.lastProcessedAt = Date.now();
          await redis.set(getRepoKey(repository), JSON.stringify(checkpoint));

          stream.write({
            type: 'progress',
            progress: checkpoint.progress,
            processedFiles: processed,
            totalFiles: filesToProcess.length,
          });
        }
      }
    }

    // Finalize embedding process
    checkpoint.status = 'completed';
    checkpoint.lastProcessedAt = Date.now();
    checkpoint.progress = 100;
    checkpoint.lastCommitSha = latestCommitSha; // Store the commit SHA for future diff comparisons

    // Before setting repository status in Redis, ensure it's properly serialized
    const statusJson = JSON.stringify(checkpoint);
    console.log(
      `Setting repository status for ${repository}: ${statusJson.substring(
        0,
        100
      )}...`
    );

    // Double check we're not storing [object Object] literal string
    if (statusJson === '[object Object]') {
      console.error(
        `CRITICAL ERROR: Attempted to store '[object Object]' string instead of JSON for ${repository}`
      );
      stream.write({
        type: 'error',
        message: `Error storing repository status. Please contact support.`,
      });
    } else {
      await redis.set(getRepoKey(repository), statusJson);

      // Return final status
      stream.write({
        type: 'complete',
        message: `Embedding ${
          isDiffMode ? 'update' : 'process'
        } completed for ${repository}. Processed ${processed} files.`,
        repository,
        totalChunks: await redis.llen(getChunkKey(repository)),
        totalFiles: filesToProcess.length,
        duration: Math.floor((Date.now() - checkpoint.startedAt) / 1000),
        commitSha: latestCommitSha,
      });
    }

    stream.end();
  } catch (error) {
    console.error(`Error embedding repository ${repository}:`, error);

    // Update checkpoint with error
    const checkpoint = {
      repository,
      status: 'failed',
      startedAt: Date.now(),
      lastProcessedAt: Date.now(),
      processedFiles: 0,
      errors: [`Global error: ${error}`],
      progress: 0,
    };

    await redis.set(getRepoKey(repository), JSON.stringify(checkpoint));

    stream.write({
      type: 'error',
      message: `Failed to embed repository: ${error}`,
    });

    stream.end();
  }
}

// Export with internal access protection
export default withInternalAccess(handler);

/**
 * Get the latest commit SHA for a repository
 */
async function getLatestCommitSha(repository: string): Promise<string> {
  try {
    const [owner, repo] = repository.split('/');
    const octokit = await getOctokitForRepo(repository);

    const { data } = await octokit.repos.getBranch({
      owner,
      repo,
      branch: 'main', // Assuming main is the default branch
    });

    return data.commit.sha;
  } catch (error) {
    console.error(`Error getting latest commit for ${repository}:`, error);
    throw error;
  }
}

/**
 * Get files changed between two commits
 */
async function getChangedFiles(
  repository: string,
  baseCommit: string,
  headCommit: string
): Promise<string[]> {
  try {
    const [owner, repo] = repository.split('/');
    const octokit = await getOctokitForRepo(repository);

    // Get the comparison between the two commits
    const { data } = await octokit.repos.compareCommits({
      owner,
      repo,
      base: baseCommit,
      head: headCommit,
    });

    // Extract all changed files
    const changedFiles =
      data.files
        ?.filter((file) => {
          // Check if it's a code file
          const extension = file.filename.substring(
            file.filename.lastIndexOf('.')
          );
          return (
            CODE_EXTENSIONS.includes(extension) &&
            // Don't include deleted files
            file.status !== 'removed'
          );
        })
        .map((file) => file.filename) || [];

    return changedFiles;
  } catch (error) {
    console.error(`Error getting changed files for ${repository}:`, error);
    throw error;
  }
}

/**
 * Remove chunks for specific files from Redis
 */
async function removeFileChunks(
  repository: string,
  filePaths: string[]
): Promise<void> {
  try {
    // Get all chunks for the repository
    const allChunks = await redis.lrange(getChunkKey(repository), 0, -1);

    // For each chunk, check if it belongs to a file path we're updating
    const chunksToKeep = [];

    for (const chunk of allChunks) {
      try {
        const parsedChunk =
          typeof chunk === 'string' ? JSON.parse(chunk) : chunk;

        // If this chunk is not from a file we're updating, keep it
        if (!filePaths.includes(parsedChunk.path)) {
          chunksToKeep.push(chunk);
        }
      } catch (error) {
        // If we can't parse the chunk, keep it to be safe
        chunksToKeep.push(chunk);
      }
    }

    // Clear all chunks and re-add the ones we want to keep
    await redis.del(getChunkKey(repository));

    // If there are chunks to keep, add them back
    if (chunksToKeep.length > 0) {
      // Add in batches to avoid request size limits
      const BATCH_SIZE = 100;
      for (let i = 0; i < chunksToKeep.length; i += BATCH_SIZE) {
        const batch = chunksToKeep.slice(i, i + BATCH_SIZE);
        await redis.lpush(getChunkKey(repository), ...batch);
      }
    }

    // Remove these files from the processed files set
    for (const path of filePaths) {
      await redis.srem(getProcessedFilesKey(repository), path);
    }
  } catch (error) {
    console.error(`Error removing file chunks for ${repository}:`, error);
    throw error;
  }
}
