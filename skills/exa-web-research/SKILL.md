---
name: exa-web-research
description: Search the live web, read pages, and conduct multi-source research with Exa. Use when facts may have changed, the user asks for current sources, or a task depends on external documentation, changelogs, issues, or examples.
metadata:
  priority: 9
  docs:
    - "https://exa.ai/docs/llms.txt"
    - "https://exa.ai/docs/get-started/exa-mcp"
---
# Exa Web Research

Use the hosted Exa MCP server for information that is current or lives outside
the repository. Prefer primary sources, and attach citations to claims derived
from the web.

## Workflow

1. Search in natural language to identify the most relevant sources.
2. Read the important pages instead of relying only on search snippets.
3. For questions requiring synthesis, use research across multiple sources.
4. State clearly when a conclusion is an inference rather than a sourced fact.

## Source selection

- For technical questions, prefer official documentation, specifications,
  changelogs, repositories, and issue trackers.
- Check publication and event dates for time-sensitive topics.
- Use Exa's documentation index at `https://exa.ai/docs/llms.txt` before
  exploring Exa API documentation in depth.
- Treat the Exa OpenAPI specifications as the source of truth for API request
  and response schemas.

## Authentication and safety

The hosted MCP connection handles its own authorization flow. For direct Exa
API or SDK work, read `EXA_API_KEY` from the environment. Never print, commit,
or embed API keys, OAuth tokens, or other credentials in source files.
