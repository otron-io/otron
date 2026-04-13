import { tool } from "ai";
import { z } from "zod";

type ToolExecutorWrapper = (name: string, fn: Function) => (...args: any[]) => any;

export function createUtilityTools(
  executor: ToolExecutorWrapper,
  sleepWithAbort: (seconds: number, abort?: AbortSignal) => Promise<string>
) {
  return {
    sleep: tool({
      description:
        "Sleep/wait for a number of seconds (max 60). Pauses the agent processing without blocking the server.",
      parameters: z.object({
        seconds: z
          .number()
          .int()
          .min(0)
          .max(60)
          .describe("Number of seconds to sleep (0-60)"),
      }),
      execute: executor("sleep", async (params: any) => {
        return await sleepWithAbort(params.seconds);
      }),
    }),
  };
}
