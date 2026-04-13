import { Redis } from "@upstash/redis";
import { env } from "./env.js";

const redis = new Redis({
  url: env.KV_REST_API_URL,
  token: env.KV_REST_API_TOKEN,
});

// Coding task dispatched from Vercel webhook handlers to the local worker
export interface CodingTask {
  id: string;
  createdAt: number;
  source: "linear" | "slack" | "github";

  // Linear context
  linearSessionId?: string;
  linearIssueId?: string;
  linearIssueIdentifier?: string;

  // Slack context
  slackChannelId?: string;
  slackThreadTs?: string;

  // Repository target
  repository: string; // "owner/repo"
  baseBranch?: string;

  // Task content
  prompt: string;
  context: string;
  intent: "work" | "review" | "research" | "auto";
}

// Result posted back by the worker after Claude Code completes
export interface CodingTaskResult {
  taskId: string;
  status: "completed" | "failed";
  summary: string;
  branchName?: string;
  prUrl?: string;
  prNumber?: number;
  error?: string;
  duration: number;
}

const TASK_TTL = 86400; // 24 hours

/**
 * Enqueue a coding task for the local worker.
 * Called from Vercel webhook handlers.
 */
export async function enqueueCodingTask(task: CodingTask): Promise<string> {
  const id = task.id;
  await redis.set(`coding_task:${id}`, JSON.stringify(task), { ex: TASK_TTL });
  await redis.lpush("coding_tasks", id);
  return id;
}

/**
 * Dequeue the next coding task (non-blocking, for Vercel inspection).
 * The actual blocking dequeue (BRPOP) lives in worker/index.ts.
 */
export async function dequeueCodingTask(): Promise<CodingTask | null> {
  const taskId = await redis.rpop<string>("coding_tasks");
  if (!taskId) return null;

  const taskData = await redis.get<string>(`coding_task:${taskId}`);
  if (!taskData) return null;

  await redis.set("coding_task_active", taskId, { ex: 3600 });

  return typeof taskData === "string" ? JSON.parse(taskData) : taskData;
}

/**
 * Store the result of a completed coding task.
 */
export async function setTaskResult(
  taskId: string,
  result: CodingTaskResult
): Promise<void> {
  await redis.set(`coding_task_result:${taskId}`, JSON.stringify(result), {
    ex: TASK_TTL,
  });
  await redis.del("coding_task_active");
}

/**
 * Get the result of a coding task (if completed).
 */
export async function getTaskResult(
  taskId: string
): Promise<CodingTaskResult | null> {
  const data = await redis.get<string>(`coding_task_result:${taskId}`);
  if (!data) return null;
  return typeof data === "string" ? JSON.parse(data) : data;
}

/**
 * Check worker availability: heartbeat, active task, and queue depth.
 */
export async function getWorkerStatus(): Promise<{
  isOnline: boolean;
  isBusy: boolean;
  queueLength: number;
}> {
  const [heartbeat, activeTask, queueLength] = await Promise.all([
    redis.get("coding_worker_heartbeat"),
    redis.get("coding_task_active"),
    redis.llen("coding_tasks"),
  ]);

  return {
    isOnline: heartbeat !== null,
    isBusy: activeTask !== null,
    queueLength,
  };
}
