# AWS Secrets Manager UI

A web-based dashboard for managing AWS Secrets Manager secrets — with group organisation, an AI assistant (Claude), key/value search, automatic backups, and an MCP server.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-green) ![License](https://img.shields.io/badge/license-ISC-blue)

## Features

- **Browse & manage secrets** — list, create, view, edit, and delete secrets across AWS regions
- **Groups & subgroups** — organise secrets into named groups for easier navigation
- **Key/Value search** — search across all secrets by key name, value, or both
- **AI assistant** — Claude-powered chat to add, update, or remove variables across groups using natural language (e.g. _"add DEBUG=false to all production secrets"_)
- **Automatic backups** — every edit is backed up locally before saving, with a browsable backup history in the UI
- **MCP server** — exposes group management as MCP tools for use with Claude Desktop or other MCP clients

## Prerequisites

- Node.js 18+
- AWS credentials configured (via `~/.aws/credentials`, environment variables, or IAM role)
- An [Anthropic API key](https://console.anthropic.com) for the AI assistant

## Setup

```bash
git clone https://github.com/your-username/aws-secrets-manager-ui.git
cd aws-secrets-manager-ui

npm install

cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
```

## Running

```bash
npm start
```

Open [http://localhost:3456](http://localhost:3456) in your browser.

## AWS Authentication

The app uses the AWS SDK default credential chain. Any of these will work:

- `~/.aws/credentials` file (e.g. configured via `aws configure`)
- Environment variables: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`
- IAM role attached to the instance/container

## MCP Server

To use the MCP server with Claude Desktop, add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "secrets-manager": {
      "command": "node",
      "args": ["/absolute/path/to/aws-secrets-manager-ui/mcp-server.js"]
    }
  }
}
```

Then start the MCP server manually if needed:

```bash
npm run mcp
```

## Project Structure

```
├── server.js           # Express API server
├── secrets-service.js  # AWS Secrets Manager + group logic
├── backup-service.js   # Local backup management
├── mcp-server.js       # MCP server for Claude Desktop
├── public/
│   └── index.html      # Single-page frontend
├── data/               # Group definitions (gitignored, auto-created)
└── backup/             # Local backups (gitignored, auto-created)
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | API key for the Claude AI assistant |
| `PORT` | No | Port to run the web UI on (default: `3456`) |
