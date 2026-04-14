import { tool } from "ai";
import { z } from "zod";
import { Redis } from "@upstash/redis";
import { env } from "../env.js";

type ToolExecutorWrapper = (
  name: string,
  fn: Function
) => (...args: any[]) => any;

const CANCELLATION_TTL = 3600; // 1 hour
const RESULT_TTL = 86400; // 24 hours

export function createCancelCodingTaskTool(executor: ToolExecutorWrapper) {
  const redis = new Redis({
    url: env.KV_REST_API_URL,
    token: env.KV_REST_API_TOKEN,
  });

  return {
    cancelCodingTask: tool({
      description:
        "Cancel a pending or active coding task in the worker queue. Use this to stop a task that was dispatched but should no longer run. Provide the taskId returned when the task was dispatched.",
      parameters: z.object({
        taskId: z
          .string()
          .describe(
            "The ID of the coding task to cancel, as returned by dispatchCodingTask."
          ),
      }),
      execute: executor(
        "cancelCodingTask",
        async (params: { taskId: string }) => {
          const { taskId } = params;

          const cancellationResult = {
            taskId,
            status: "failed" as const,
            summary: "Task cancelled by user",
            error: "User requested cancellation",
            duration: 0,
          };

          // Check if the task is currently active
          const activeTaskId = await redis.get<string>("coding_task_active");

          if (activeTaskId === taskId) {
            // Task is currently running — set cancellation flag and clear active marker
            await Promise.all([
              redis.set(`task_cancelled:${taskId}`, "true", {
                ex: CANCELLATION_TTL,
              }),
              redis.del("coding_task_active"),
              redis.set(
                `coding_task_result:${taskId}`,
                JSON.stringify(cancellationResult),
                { ex: RESULT_TTL }
              ),
            ]);

            return `Cancelled active coding task ${taskId}. The worker will stop execution shortly.`;
          }

          // Task may be queued but not yet running — remove from the queue
          const removed = await redis.lrem("coding_tasks", 1, taskId);

          if (removed > 0) {
            // Task was in the queue; clean up its stored data
            await Promise.all([
              redis.del(`coding_task:${taskId}`),
              redis.set(
                `coding_task_result:${taskId}`,
                JSON.stringify(cancellationResult),
                { ex: RESULT_TTL }
              ),
            ]);

            return `Cancelled queued coding task ${taskId}. The task was removed from the queue and will not be executed.`;
          }

          // Task not found in queue or as active — may have already completed/failed
          return `Task ${taskId} was not found in the queue or as the active task. It may have already completed or been cancelled.`;
        }
      ),
    }),
  };
}
