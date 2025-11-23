# Obsidian MCP Server

This is a Model Context Protocol (MCP) server that exposes a local Obsidian Vault to LLMs. It allows AI assistants to read, write, and search notes within your vault.

## Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Build the server:
   ```bash
   npm run build
   ```

## Configuration

You can use this server with any MCP-compatible client (like Claude Desktop).

### Claude Desktop Configuration

Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/obsidian-mcp-server/build/index.js",
        "/ABSOLUTE/PATH/TO/YOUR/VAULT"
      ]
    }
  }
}
```

## Tools

- **read_note**: Read the content of a specific note.
- **write_note**: Create a new note or overwrite an existing one.
- **append_to_note**: Append text to the end of an existing note.
- **patch_note**: Replace a specific text segment in a note (useful for targeted edits).
- **search_notes**: Search for notes by query (fuzzy match on content or filename).
- **list_notes**: List all markdown files in the vault (recursive).
