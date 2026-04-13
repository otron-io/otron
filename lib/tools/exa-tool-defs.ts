import { tool } from "ai";
import { z } from "zod";
import {
  executeExaSearch,
  executeExaCrawlContent,
  executeExaFindSimilar,
} from "../exa/exa-utils.js";

type ToolExecutorWrapper = (
  name: string,
  fn: Function
) => (...args: any[]) => any;

export function createExaTools(
  executor: ToolExecutorWrapper,
  updateStatus?: (status: string) => void
) {
  return {
    exaSearch: tool({
      description:
        "Comprehensive web search, answer generation, and research using Exa AI. Supports three modes: search (find web content), answer (get AI-powered answers with sources), and research (comprehensive analysis). This is the primary tool for web-based information gathering.",
      parameters: z.object({
        query: z.string().describe("The search query or question to ask"),
        mode: z
          .enum(["search", "answer", "research"])
          .describe(
            'Mode: "search" for finding web content, "answer" for AI-powered answers with sources, "research" for comprehensive analysis with multiple sources'
          ),
        numResults: z
          .number()
          .describe(
            "Number of results to return (default: 5 for search/answer, 10 for research). Use 5 if not specified."
          ),
        includeContent: z
          .boolean()
          .describe(
            "Whether to include full content/text from sources (default: true for research, false for search). Use true for research mode."
          ),
        livecrawl: z
          .enum(["always", "never", "when-necessary"])
          .describe(
            'Live crawling behavior: "always" for fresh content, "never" for cached only, "when-necessary" for smart crawling (default). Use "when-necessary" if not specified.'
          ),
        timeRange: z
          .string()
          .describe(
            'Optional time filter for content age: "day", "week", "month", "year". Leave empty for no time restriction.'
          ),
        domainFilter: z
          .string()
          .describe(
            'Optional domain to restrict search to (e.g., "github.com"). Leave empty for all domains.'
          ),
        fileType: z
          .string()
          .describe(
            'Optional file type filter (e.g., "pdf", "doc"). Leave empty for all file types.'
          ),
        category: z
          .string()
          .describe(
            "Optional content category filter. Leave empty for all categories."
          ),
        useAutoprompt: z
          .boolean()
          .describe(
            "Whether to use Exa autoprompt for improved query understanding (default: true). Use true if not specified."
          ),
      }),
      execute: executor("exaSearch", (params: any) =>
        executeExaSearch(params, updateStatus)
      ),
    }),

    exaCrawlContent: tool({
      description:
        "Crawl and extract content from specific URLs using Exa. Get full text, HTML, links, and metadata from web pages.",
      parameters: z.object({
        urls: z
          .array(z.string())
          .describe("Array of URLs to crawl and extract content from"),
        includeLinks: z
          .boolean()
          .describe(
            "Whether to extract links from the pages (default: false). Use false if not specified."
          ),
        includeImages: z
          .boolean()
          .describe(
            "Whether to extract image information (default: false). Use false if not specified."
          ),
        includeMetadata: z
          .boolean()
          .describe(
            "Whether to extract page metadata (default: true). Use true if not specified."
          ),
        textOnly: z
          .boolean()
          .describe(
            "Whether to return only text content without HTML (default: false). Use false if not specified."
          ),
      }),
      execute: executor("exaCrawlContent", (params: any) =>
        executeExaCrawlContent(params, updateStatus)
      ),
    }),

    exaFindSimilar: tool({
      description:
        "Find content similar to a given URL using Exa semantic search. Great for discovering related articles, papers, or content.",
      parameters: z.object({
        url: z.string().describe("The URL to find similar content for"),
        numResults: z
          .number()
          .describe(
            "Number of similar results to return (default: 5). Use 5 if not specified."
          ),
        includeContent: z
          .boolean()
          .describe(
            "Whether to include full content from similar pages (default: false). Use false if not specified."
          ),
        livecrawl: z
          .enum(["always", "never", "when-necessary"])
          .describe(
            'Live crawling behavior for similar content (default: "when-necessary"). Use "when-necessary" if not specified.'
          ),
        excludeSourceDomain: z
          .boolean()
          .describe(
            "Whether to exclude results from the same domain as the source URL (default: true). Use true if not specified."
          ),
      }),
      execute: executor("exaFindSimilar", (params: any) =>
        executeExaFindSimilar(params, updateStatus)
      ),
    }),
  };
}
