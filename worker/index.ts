import { Redis } from "@upstash/redis";
import { workerEnv } from "./env.js";
import { ensureRepo } from "./repo-manager.js";
import { executeCodingTask } from "./execute-task.js";
import { reportResult, createActivityReporter } from "./report-results.js";
import type { CodingTask, CodingTaskResult } from "../lib/task-queue.js";

const redis = new Redis({
  url: workerEnv.REDIS_URL,
  token: workerEnv.REDIS_TOKEN,
});

const TASK_TTL = 86400; // 24 hours

async function dequeueCodingTask(): Promise<CodingTask | null> {
  // Upstash REST client doesn't support BRPOP, so we use RPOP and poll
  const taskId = await redis.rpop<string>("coding_tasks");
  if (!taskId) return null;

  const taskData = await redis.get<string>(`coding_task:${taskId}`);
  if (!taskData) return null;

  await redis.set("coding_task_active", taskId, { ex: 3600 });

  return typeof taskData === "string" ? JSON.parse(taskData) : taskData;
}

async function setTaskResult(
  taskId: string,
  result: CodingTaskResult
): Promise<void> {
  await redis.set(`coding_task_result:${taskId}`, JSON.stringify(result), {
    ex: TASK_TTL,
  });
  await redis.del("coding_task_active");
}

async function processTask(task: CodingTask): Promise<void> {
  const startTime = Date.now();
  console.log(
    `\n${"=".repeat(60)}\nProcessing task ${task.id}\n  Source: ${task.source}\n  Intent: ${task.intent}\n  Repo: ${task.repository}\n  Issue: ${task.linearIssueIdentifier || "n/a"}\n${"=".repeat(60)}`
  );

  try {
    // Clone/update the target repo
    const repoPath = await ensureRepo(task.repository, task.baseBranch);
    console.log(`Repo ready at: ${repoPath}`);

    // Execute the coding task via Claude Agent SDK
    // Stream activity to Linear/Slack in real time
    const onActivity = createActivityReporter(task);
    const execResult = await executeCodingTask(task, repoPath, onActivity);

    // Build the final result
    const result: CodingTaskResult = {
      taskId: task.id,
      status: execResult.status,
      summary: execResult.summary,
      error: execResult.error,
      duration: Date.now() - startTime,
    };

    // Store result in Redis
    await setTaskResult(task.id, result);

    // Report back to originating platform
    await reportResult(task, result);

    console.log(
      `Task ${task.id} ${result.status} in ${Math.round(result.duration / 1000)}s`
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`Task ${task.id} failed:`, errMsg);

    const result: CodingTaskResult = {
      taskId: task.id,
      status: "failed",
      summary: "Worker failed to process task",
      error: errMsg,
      duration: Date.now() - startTime,
    };

    await setTaskResult(task.id, result);
    await reportResult(task, result);
  }
}

async function main(): Promise<never> {
  // Check Linear auth from Redis
  const { getLinearAccessToken } = await import("./linear-auth.js");
  const linearToken = await getLinearAccessToken();

  console.log("Otron Worker started");
  console.log(`  Repos dir: ${workerEnv.REPOS_DIR}`);
  console.log(`  Redis: ${workerEnv.REDIS_URL}`);
  console.log(`  GitHub App: ${workerEnv.GITHUB_APP_ID}`);
  console.log(`  Slack: ${workerEnv.SLACK_BOT_TOKEN ? "configured" : "not configured"}`);
  console.log(`  Linear: ${linearToken ? "configured (token from Redis)" : "not configured (no token in Redis)"}`);
  console.log("\nWaiting for tasks...\n");

  // Graceful shutdown
  const shutdown = () => {
    console.log("\nShutting down gracefully...");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Main polling loop — poll every 2s when idle
  while (true) {
    try {
      const task = await dequeueCodingTask();
      if (task) {
        await processTask(task);
      } else {
        // No task available, wait before polling again
        await new Promise((r) => setTimeout(r, 2000));
      }
    } catch (error) {
      console.error("Error in polling loop:", error);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

main();
