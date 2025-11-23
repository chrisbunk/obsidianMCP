#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs/promises";
import * as path from "path";
import { glob } from "glob";
import { z } from "zod";

const VAULT_PATH = process.argv[2];

if (!VAULT_PATH) {
  console.error("Usage: obsidian-mcp-server <vault-path>");
  process.exit(1);
}

// Normalize and resolve the vault path
const ABSOLUTE_VAULT_PATH = path.resolve(VAULT_PATH);

console.error(`Starting Obsidian MCP Server for vault: ${ABSOLUTE_VAULT_PATH}`);

const server = new Server(
  {
    name: "obsidian-mcp-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  }
);

// Helper to validate paths are within the vault
function getSafePath(relativePath: string): string {
  // Handle if user provided absolute path by mistake, try to make it relative or check if it's in vault
  let targetPath = path.resolve(ABSOLUTE_VAULT_PATH, relativePath);
  
  // If the path doesn't end with .md, append it (optional, but good for Obsidian)
  // But we shouldn't enforce it strictly if they want to read other files
  
  if (!targetPath.startsWith(ABSOLUTE_VAULT_PATH)) {
    throw new Error("Access denied: Path is outside the vault");
  }
  return targetPath;
}

/**
 * Handler for listing available tools
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "read_note",
        description: "Read the content of a note in the Obsidian vault",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Relative path to the note (e.g., 'Daily/2024-01-01.md')",
            },
          },
          required: ["path"],
        },
      },
      {
        name: "write_note",
        description: "Create or overwrite a note in the Obsidian vault",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Relative path to the note",
            },
            content: {
              type: "string",
              description: "The content to write to the note",
            },
          },
          required: ["path", "content"],
        },
      },
      {
        name: "append_to_note",
        description: "Append text to the end of an existing note",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Relative path to the note",
            },
            content: {
              type: "string",
              description: "The content to append",
            },
          },
          required: ["path", "content"],
        },
      },
      {
        name: "patch_note",
        description: "Replace specific text in a note with new text",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Relative path to the note",
            },
            old_text: {
              type: "string",
              description: "The text to be replaced",
            },
            new_text: {
              type: "string",
              description: "The new text to insert",
            },
          },
          required: ["path", "old_text", "new_text"],
        },
      },
      {
        name: "search_notes",
        description: "Search for notes containing a specific query string",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The text to search for",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "list_notes",
        description: "List all markdown files in the vault",
        inputSchema: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description: "Maximum number of files to return (default 50)",
            },
          },
        },
      },
    ],
  };
});

/**
 * Handler for calling tools
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    switch (request.params.name) {
      case "read_note": {
        const { path: notePath } = request.params.arguments as { path: string };
        const safePath = getSafePath(notePath);
        
        try {
          const stats = await fs.stat(safePath);
          if (!stats.isFile()) {
            throw new Error("Path exists but is not a file");
          }
          const content = await fs.readFile(safePath, "utf-8");
          return {
            content: [{ type: "text", text: content }],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error reading file: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true,
          };
        }
      }

      case "write_note": {
        const { path: notePath, content } = request.params.arguments as { path: string; content: string };
        const safePath = getSafePath(notePath);
        
        // Ensure directory exists
        await fs.mkdir(path.dirname(safePath), { recursive: true });
        await fs.writeFile(safePath, content, "utf-8");
        
        return {
          content: [{ type: "text", text: `Successfully wrote to ${notePath}` }],
        };
      }

      case "append_to_note": {
        const { path: notePath, content } = request.params.arguments as { path: string; content: string };
        const safePath = getSafePath(notePath);
        
        await fs.appendFile(safePath, "\n" + content, "utf-8");
        
        return {
          content: [{ type: "text", text: `Successfully appended to ${notePath}` }],
        };
      }

      case "patch_note": {
        const { path: notePath, old_text, new_text } = request.params.arguments as { path: string; old_text: string; new_text: string };
        const safePath = getSafePath(notePath);
        
        const content = await fs.readFile(safePath, "utf-8");
        if (!content.includes(old_text)) {
          throw new Error("Could not find old_text in file");
        }
        
        const newContent = content.replace(old_text, new_text);
        await fs.writeFile(safePath, newContent, "utf-8");
        
        return {
          content: [{ type: "text", text: `Successfully patched ${notePath}` }],
        };
      }

      case "search_notes": {
        const { query } = request.params.arguments as { query: string };
        
        // Use glob to find all md files
        // Note: simple grep search might be slow for huge vaults, but good for v1
        const files = await glob("**/*.md", { cwd: ABSOLUTE_VAULT_PATH, ignore: "node_modules/**" });
        const results = [];
        
        for (const file of files) {
          const safePath = getSafePath(file);
          const content = await fs.readFile(safePath, "utf-8");
          
          if (content.toLowerCase().includes(query.toLowerCase()) || file.toLowerCase().includes(query.toLowerCase())) {
            // Get context snippet
            const index = content.toLowerCase().indexOf(query.toLowerCase());
            let snippet = "";
            if (index !== -1) {
              const start = Math.max(0, index - 50);
              const end = Math.min(content.length, index + query.length + 50);
              snippet = content.substring(start, end).replace(/\n/g, " ");
            }
            
            results.push({
              path: file,
              snippet: snippet ? `...${snippet}...` : "Matched in filename",
            });
            
            if (results.length >= 20) break; // Limit search results
          }
        }
        
        return {
          content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        };
      }

      case "list_notes": {
        const { limit = 50 } = request.params.arguments as { limit?: number };
        const files = await glob("**/*.md", { cwd: ABSOLUTE_VAULT_PATH, ignore: ["node_modules/**", ".git/**", ".obsidian/**"] });
        const sliced = files.slice(0, limit);
        
        return {
          content: [{ type: "text", text: JSON.stringify(sliced, null, 2) }],
        };
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
    }
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    };
  }
});

/**
 * Handler for listing resources
 * Exposes all notes as resources with obsidian:// URI scheme
 */
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const files = await glob("**/*.md", { cwd: ABSOLUTE_VAULT_PATH, ignore: ["node_modules/**", ".git/**", ".obsidian/**"] });
  
  return {
    resources: files.map((file) => ({
      uri: `obsidian:///${file}`, // Note: simplistic URI scheme
      name: file,
      mimeType: "text/markdown",
    })),
  };
});

/**
 * Handler for reading resources
 */
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const url = new URL(request.params.uri);
  // Extract relative path from URI
  // uri is likely obsidian:///path/to/note.md
  const relativePath = decodeURIComponent(url.pathname).replace(/^\//, ""); 
  const safePath = getSafePath(relativePath);
  
  const content = await fs.readFile(safePath, "utf-8");
  
  return {
    contents: [{
      uri: request.params.uri,
      mimeType: "text/markdown",
      text: content,
    }],
  };
});

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
