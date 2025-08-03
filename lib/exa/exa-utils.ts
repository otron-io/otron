import { exa } from "../core/utils.js";

// Enhanced Exa search and answer tools
export const executeExaSearch = async (
  {
    query,
    mode,
    numResults,
    includeContent,
    livecrawl,
    timeRange,
    domainFilter,
    fileType,
    category,
    useAutoprompt,
  }: {
    query: string;
    mode: "search" | "answer" | "research";
    numResults: number;
    includeContent: boolean;
    livecrawl: "always" | "never" | "when-necessary";
    timeRange?: string;
    domainFilter?: string;
    fileType?: string;
    category?: string;
    useAutoprompt: boolean;
  },
  updateStatus?: (status: string) => void,
) => {
  try {
    if (mode === "answer") {
      updateStatus?.(`is getting AI-powered answer for: ${query}...`);

      const answerOptions: any = {
        useAutoprompt,
        numResults: numResults || 5,
        livecrawl: livecrawl || "when-necessary",
      };

      if (timeRange?.trim()) {
        const timeRangeMap: { [key: string]: string } = {
          day: "1d",
          week: "1w",
          month: "1m",
          year: "1y",
        };
        answerOptions.startCrawlDate = timeRangeMap[timeRange];
      }

      if (domainFilter?.trim()) {
        answerOptions.includeDomains = [domainFilter];
      }

      if (category?.trim()) {
        answerOptions.category = category;
      }

      const response = await exa.answer(query, answerOptions);

      return {
        mode: "answer",
        answer: response.answer,
        sources:
          response.citations?.map((citation: any) => ({
            title: citation.title || "",
            url: citation.url || "",
            snippet: citation.text?.slice(0, 500) || "",
            publishedDate: citation.publishedDate,
            author: citation.author,
          })) || [],
        query: query,
      };
    }
    if (mode === "research") {
      updateStatus?.(`is conducting research on: ${query}...`);

      // Use multiple search strategies for comprehensive research
      const searchOptions: any = {
        type: "neural",
        numResults: numResults || 10,
        livecrawl: livecrawl || "always",
        text: includeContent,
        highlights: true,
        summary: true,
      };

      if (timeRange?.trim()) {
        const timeRangeMap: { [key: string]: string } = {
          day: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          week: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          month: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
          year: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
        };
        searchOptions.startPublishedDate = timeRangeMap[timeRange];
      }

      if (domainFilter?.trim()) {
        searchOptions.includeDomains = [domainFilter];
      }

      if (fileType?.trim()) {
        searchOptions.includeText = [fileType];
      }

      if (category?.trim()) {
        searchOptions.category = category;
      }

      const searchResults = await exa.searchAndContents(query, searchOptions);

      // Enhanced formatting for research mode
      const processedResults = searchResults.results.map((result: any) => ({
        title: result.title,
        url: result.url,
        content: result.text || "",
        summary: result.summary || "",
        highlights: result.highlights || [],
        highlightScores: result.highlightScores || [],
        publishedDate: result.publishedDate,
        author: result.author,
        score: result.score,
        image: result.image,
        subpages: result.subpages || [],
      }));

      return {
        mode: "research",
        results: processedResults,
        totalResults: processedResults.length,
        query: query,
        researchSummary: `Research conducted on "${query}" returned ${processedResults.length} comprehensive sources with content analysis.`,
      };
    }
    // Standard search mode
    updateStatus?.(`is searching for: ${query}...`);

    const searchOptions: any = {
      type: useAutoprompt ? "auto" : "neural",
      numResults: numResults || 5,
      livecrawl: livecrawl || "when-necessary",
      text: includeContent,
      highlights: includeContent,
    };

    if (timeRange?.trim()) {
      const timeRangeMap: { [key: string]: string } = {
        day: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        week: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        month: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        year: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
      };
      searchOptions.startPublishedDate = timeRangeMap[timeRange];
    }

    if (domainFilter?.trim()) {
      searchOptions.includeDomains = [domainFilter];
    }

    if (fileType?.trim()) {
      searchOptions.includeText = [fileType];
    }

    if (category?.trim()) {
      searchOptions.category = category;
    }

    const searchFunction = includeContent ? exa.searchAndContents : exa.search;
    const response = await searchFunction(query, searchOptions);

    return {
      mode: "search",
      results: response.results.map((result: any) => ({
        title: result.title,
        url: result.url,
        snippet: result.text?.slice(0, 1000) || result.summary || "",
        content: result.text || "",
        highlights: result.highlights || [],
        publishedDate: result.publishedDate,
        author: result.author,
        score: result.score,
        image: result.image,
      })),
      totalResults: response.results.length,
      query: query,
    };
  } catch (error) {
    console.error("Error in Exa search:", error);
    return {
      mode,
      error: error instanceof Error ? error.message : "Unknown error occurred",
      query,
      results: [],
    };
  }
};

export const executeExaCrawlContent = async (
  {
    urls,
    includeLinks,
    includeImages,
    includeMetadata,
    textOnly,
  }: {
    urls: string[];
    includeLinks: boolean;
    includeImages: boolean;
    includeMetadata: boolean;
    textOnly: boolean;
  },
  updateStatus?: (status: string) => void,
) => {
  try {
    updateStatus?.(`is crawling content from ${urls.length} URL(s)...`);

    const crawlOptions: any = {
      text: true,
      includeHtml: !textOnly,
      includeLinks: includeLinks,
      includeMetadata: includeMetadata,
    };

    const response = await exa.getContents(urls, crawlOptions);

    return {
      success: true,
      results: response.results.map((result: any) => ({
        url: result.url,
        title: result.title,
        content: result.text || "",
        html: result.html || "",
        links: result.links || [],
        metadata: result.metadata || {},
        author: result.author,
        publishedDate: result.publishedDate,
        image: result.image,
      })),
      totalCrawled: response.results.length,
    };
  } catch (error) {
    console.error("Error in Exa crawl:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
      results: [],
    };
  }
};

export const executeExaFindSimilar = async (
  {
    url,
    numResults,
    includeContent,
    livecrawl,
    excludeSourceDomain,
  }: {
    url: string;
    numResults: number;
    includeContent: boolean;
    livecrawl: "always" | "never" | "when-necessary";
    excludeSourceDomain: boolean;
  },
  updateStatus?: (status: string) => void,
) => {
  try {
    updateStatus?.(`is finding content similar to: ${url}...`);

    const similarOptions: any = {
      numResults: numResults || 5,
      text: includeContent,
      livecrawl: livecrawl || "when-necessary",
      excludeSourceDomain: excludeSourceDomain,
    };

    const response = await exa.findSimilar(url, similarOptions);

    return {
      success: true,
      sourceUrl: url,
      results: response.results.map((result: any) => ({
        title: result.title,
        url: result.url,
        snippet: result.text?.slice(0, 1000) || "",
        content: result.text || "",
        publishedDate: result.publishedDate,
        author: result.author,
        score: result.score,
        image: result.image,
      })),
      totalResults: response.results.length,
    };
  } catch (error) {
    console.error("Error in Exa find similar:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
      sourceUrl: url,
      results: [],
    };
  }
};

// Legacy web search function for backward compatibility
export const executeSearchWeb = async (
  { query }: { query: string },
  updateStatus?: (status: string) => void,
) => {
  updateStatus?.(`is searching the web for ${query}...`);
  const { results } = await exa.searchAndContents(query, {
    livecrawl: "always",
    numResults: 3,
  });

  return {
    results: results.map((result: any) => ({
      title: result.title,
      url: result.url,
      snippet: result.text.slice(0, 1000),
    })),
  };
};
