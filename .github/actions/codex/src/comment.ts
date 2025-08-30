import type { EnvContext } from "./env-context";
import { runCodex } from "./run-codex";
import { postComment } from "./post-comment";
import { addEyesReaction } from "./add-reaction";
import * as github from "@actions/github";
import { maybePublishPRForIssue } from "./git-helpers";

/**
 * Handle `issue_comment` and `pull_request_review_comment` events once we know
 * the action is supported.
 */
export async function onComment(ctx: EnvContext): Promise<void> {
  const triggerPhrase = ctx.tryGet("INPUT_TRIGGER_PHRASE");
  if (!triggerPhrase) {
    console.warn("Empty trigger phrase: skipping.");
    return;
  }

  // Attempt to get the body of the comment from the environment. Depending on
  // the event type either `GITHUB_EVENT_COMMENT_BODY` (issue & PR comments) or
  // `GITHUB_EVENT_REVIEW_BODY` (PR reviews) is set.
  const commentBody =
    ctx.tryGetNonEmpty("GITHUB_EVENT_COMMENT_BODY") ??
    ctx.tryGetNonEmpty("GITHUB_EVENT_REVIEW_BODY") ??
    ctx.tryGetNonEmpty("GITHUB_EVENT_ISSUE_BODY") ??
    ctx.tryGetNonEmpty("GITHUB_EVENT_PULL_REQUEST_BODY");

  if (!commentBody) {
    console.warn("Comment body not found in environment: skipping.");
    return;
  }

  // Check if the trigger phrase is present.
  if (!commentBody.includes(triggerPhrase)) {
    console.log(
      `Trigger phrase '${triggerPhrase}' not found: nothing to do for this comment.`,
    );
    return;
  }

  // Derive the prompt by removing the trigger phrase. Remove only the first
  // occurrence to keep any additional occurrences that might be meaningful.
  const prompt = commentBody.replace(triggerPhrase, "").trim();

  let effectivePrompt = prompt;
  if (effectivePrompt.length === 0) {
    const intent = ctx.tryGet("OTRON_INTENT") ?? "auto";
    if (intent === "review") {
      effectivePrompt =
        "Perform a thorough PR review. Provide granular, actionable feedback with suggested code changes where helpful. Keep an executive summary concise.";
    } else if (intent === "research") {
      effectivePrompt =
        "Research the request in detail and respond with a structured, thorough answer or technical plan. Do not make code changes.";
    } else {
      // work/auto default
      effectivePrompt =
        "Act as an autonomous engineer. If this is an issue, implement the fix/feature and open a PR. If this is a PR, resolve review comments and make necessary edits to get it ready to merge. Include a concise status update.";
    }
  }

  // Provide immediate feedback that we are working on the request.
  await addEyesReaction(ctx);

  // Add working label on the issue/PR for visibility
  await addWorkingLabelSafely();

  try {
    // Run Codex and post the response as a new comment.
    let lastMessage = await runCodex(effectivePrompt, ctx);

    // If we're in work/auto mode, attempt to publish any local changes as a PR
    const intent = ctx.tryGet("OTRON_INTENT") ?? "";
    if (intent === "work" || intent === "auto") {
      try {
        const prUrl = await maybePublishPRForIssue(0, lastMessage, ctx);
        if (prUrl) {
          lastMessage += `\n\n---\nOpened pull request: ${prUrl}`;
        }
      } catch (e) {
        // Best-effort: log and continue
        console.warn(`PR publish attempt failed: ${e}`);
      }
    }

    await postComment(lastMessage, ctx);
  } finally {
    // Best-effort cleanup of the working label
    await removeWorkingLabelSafely();
  }
}

async function addWorkingLabelSafely(): Promise<void> {
  try {
    const octokit = github.getOctokit(
      process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "",
    );
    const { owner, repo } = github.context.repo;
    const issueNumber = github.context.issue.number;
    if (!issueNumber) return;
    await octokit.rest.issues.addLabels({
      owner,
      repo,
      issue_number: issueNumber,
      labels: ["otron:working"],
    });
  } catch (e) {
    console.warn(`Failed to add working label: ${e}`);
  }
}

async function removeWorkingLabelSafely(): Promise<void> {
  try {
    const octokit = github.getOctokit(
      process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "",
    );
    const { owner, repo } = github.context.repo;
    const issueNumber = github.context.issue.number;
    if (!issueNumber) return;
    await octokit.rest.issues.removeLabel({
      owner,
      repo,
      issue_number: issueNumber,
      name: "otron:working",
    });
  } catch (e) {
    // Ignore if label missing or removal fails
    console.warn(`Failed to remove working label: ${e}`);
  }
}
