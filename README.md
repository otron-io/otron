# Linear Agent

A smart AI assistant that helps improve Linear tickets by analyzing issues, filling in missing information, and answering questions about tickets.

## Features

- Automatically analyses new tickets for missing information
- Answers questions about tickets when mentioned
- Refines tickets with detailed suggestions when requested
- Integrates directly with Linear as a teammate

## Setup

Visit https://linear.fingertip.com to install the agent in your workspace

## Usage

Mention the agent in any ticket:

- `@Agent What's missing from this ticket?`
- `@Agent refine`
- `@Agent What dependencies should I consider?`

## Development

```bash
npm install
npm run dev
```

Built with Vercel AI SDK, Linear API, and Upstash Redis.
