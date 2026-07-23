/**
 * Obsidian Local REST API Extension for pi
 *
 * Provides tools to read, write, search and manage Obsidian vault files
 * through the Obsidian Local REST API plugin (v4.1.7).
 *
 * Configuration (env vars — no secrets are baked into the source):
 *   OBSIDIAN_API_URL  - base URL of the Local REST API (default http://127.0.0.1:27123)
 *   OBSIDIAN_API_KEY  - the API key/token (sent as `Bearer <key>`; required)
 *
 * Available API endpoints:
 *   GET    /              - API information
 *   GET    /vault/{path}  - Read file or list directory
 *   PUT    /vault/{path}  - Write/create a file (raw body)
 *   POST   /vault/{path}  - Append to a file (text/markdown content-type)
 *   DELETE /vault/{path}  - Delete a file or folder
 *
 * Usage:
 *   pi install <this-repo>           (persisted via package.json pi.extensions)
 *   pi -e ./index.ts                 (one-off load)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// ============================================================================
// Configuration
// ============================================================================

const OBSIDIAN_BASE_URL =
  process.env.OBSIDIAN_API_URL ?? "http://127.0.0.1:27123";

const OBSIDIAN_API_KEY = process.env.OBSIDIAN_API_KEY ?? "";

const OBSIDIAN_TOKEN = `Bearer ${OBSIDIAN_API_KEY}`;

// ============================================================================
// HTTP Helper
// ============================================================================

async function obsidianFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${OBSIDIAN_BASE_URL}${path}`;
  const headers: Record<string, string> = {
    Authorization: OBSIDIAN_TOKEN,
    ...(options.headers as Record<string, string> ?? {}),
  };
  return fetch(url, { ...options, headers });
}

function encodePath(path: string): string {
  // Encode each path segment individually to preserve slashes
  return path.split("/").map(encodeURIComponent).join("/");
}

function formatFileList(json: { files: string[] }): string {
  if (!json.files || json.files.length === 0) {
    return "*(empty directory)*";
  }
  const lines = json.files.map((f) => {
    if (f.endsWith("/")) {
      return `📁 **${f}**`;
    }
    return `📄 ${f}`;
  });
  return `**Vault — ${json.files.length} items**\n\n${lines.join("\n")}`;
}

function toolError(status: number, msg: string): string {
  return `⚠️ **Error ${status}**: ${msg}`;
}

// Message shown whenever a tool is used without a configured API key.
const MISSING_KEY_MESSAGE =
  "⚠️ **OBSIDIAN_API_KEY is not set.** Set the `OBSIDIAN_API_KEY` environment " +
  "variable (and `OBSIDIAN_API_URL` if your vault is not at " +
  `${OBSIDIAN_BASE_URL}) before using the Obsidian tools. ` +
  "Get the key from Obsidian → Settings → Local REST API.";

// Whether the extension has a usable API key configured.
function hasApiKey(): boolean {
  return OBSIDIAN_API_KEY.trim().length > 0;
}

// Tool result returned when no API key is configured — keeps prompting the user
// to set OBSIDIAN_API_KEY on every tool call, not just at session start.
function missingKeyResult() {
  return {
    content: [{ type: "text" as const, text: MISSING_KEY_MESSAGE }],
    details: {},
  };
}

// ============================================================================
// Extension
// ============================================================================

export default function (pi: ExtensionAPI) {
  // ── Session Start Notification ──
  pi.on("session_start", async (_event, ctx) => {
    if (!hasApiKey()) {
      ctx.ui.notify(
        "⚠️ OBSIDIAN_API_KEY is not set — export it (and OBSIDIAN_API_URL if needed) to reach your vault.",
        "warning",
      );
      return;
    }
    try {
      const res = await obsidianFetch("/");
      if (res.ok) {
        ctx.ui.notify("✅ Obsidian vault connected", "info");
      } else {
        ctx.ui.notify(`⚠️ Obsidian API: ${res.status} ${res.statusText}`, "warning");
      }
    } catch {
      ctx.ui.notify("❌ Obsidian vault unreachable", "error");
    }
  });

  // ── Tool: obsidian_read ──
  pi.registerTool({
    name: "obsidian_read",
    label: "Obsidian Read",
    description: "Read a file from the Obsidian vault. Returns the full content as markdown text.",
    parameters: Type.Object({
      path: Type.String({
        description:
          "File path relative to vault root, e.g. 'Folder/note.md' or '日记/2025-01-01.md'",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (!hasApiKey()) return missingKeyResult();
      const res = await obsidianFetch(`/vault/${encodePath(params.path)}`);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return {
          content: [{ type: "text", text: toolError(res.status, text || res.statusText) }],
          details: {},
        };
      }
      const text = await res.text();
      return {
        content: [{ type: "text", text }],
        details: { file: params.path },
      };
    },
  });

  // ── Tool: obsidian_write ──
  pi.registerTool({
    name: "obsidian_write",
    label: "Obsidian Write",
    description:
      "Write or overwrite a file in the Obsidian vault. Creates parent directories automatically. Use this to create new notes or update existing ones.",
    parameters: Type.Object({
      path: Type.String({
        description: "File path relative to vault root, e.g. 'Folder/note.md'",
      }),
      content: Type.String({ description: "Full markdown content to write" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (!hasApiKey()) return missingKeyResult();
      const res = await obsidianFetch(`/vault/${encodePath(params.path)}`, {
        method: "PUT",
        body: params.content,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return {
          content: [{ type: "text", text: toolError(res.status, text || res.statusText) }],
          details: {},
        };
      }
      return {
        content: [{ type: "text", text: `✅ Written to \`${params.path}\`` }],
        details: {},
      };
    },
  });

  // ── Tool: obsidian_append ──
  pi.registerTool({
    name: "obsidian_append",
    label: "Obsidian Append",
    description:
      "Append content to the end of an existing file in the Obsidian vault. Fails if the file doesn't exist.",
    parameters: Type.Object({
      path: Type.String({
        description: "File path relative to vault root, e.g. 'Folder/note.md'",
      }),
      content: Type.String({ description: "Content to append to the file" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (!hasApiKey()) return missingKeyResult();
      const res = await obsidianFetch(`/vault/${encodePath(params.path)}`, {
        method: "POST",
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
        body: params.content,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return {
          content: [{ type: "text", text: toolError(res.status, text || res.statusText) }],
          details: {},
        };
      }
      return {
        content: [{ type: "text", text: `✅ Appended to \`${params.path}\`` }],
        details: {},
      };
    },
  });

  // ── Tool: obsidian_delete ──
  pi.registerTool({
    name: "obsidian_delete",
    label: "Obsidian Delete",
    description: "Delete a file or an empty folder from the Obsidian vault. Use with caution — this is permanent.",
    parameters: Type.Object({
      path: Type.String({ description: "File or folder path relative to vault root" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (!hasApiKey()) return missingKeyResult();
      const res = await obsidianFetch(`/vault/${encodePath(params.path)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return {
          content: [{ type: "text", text: toolError(res.status, text || res.statusText) }],
          details: {},
        };
      }
      return {
        content: [{ type: "text", text: `✅ Deleted \`${params.path}\`` }],
        details: {},
      };
    },
  });

  // ── Tool: obsidian_list ──
  pi.registerTool({
    name: "obsidian_list",
    label: "Obsidian List",
    description:
      "List files and folders in the Obsidian vault at a given path. Returns a formatted directory listing with 📁 for folders and 📄 for files.",
    parameters: Type.Object({
      path: Type.Optional(
        Type.String({
          description:
            "Directory path relative to vault root. Empty or omitted lists the vault root.",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (!hasApiKey()) return missingKeyResult();
      const dirPath = params.path ?? "";
      const encoded = dirPath ? `/vault/${encodePath(dirPath)}` : "/vault/";
      const res = await obsidianFetch(encoded);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return {
          content: [{ type: "text", text: toolError(res.status, text || res.statusText) }],
          details: {},
        };
      }
      const json = await res.json();
      const formatted = formatFileList(json as { files: string[] });
      return {
        content: [{ type: "text", text: formatted }],
        details: {},
      };
    },
  });

  // ── Tool: obsidian_info ──
  pi.registerTool({
    name: "obsidian_info",
    label: "Obsidian API Info",
    description:
      "Get information about the Obsidian Local REST API, including version numbers and authentication status.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      if (!hasApiKey()) return missingKeyResult();
      const res = await obsidianFetch("/");
      if (!res.ok) {
        return {
          content: [{ type: "text", text: toolError(res.status, res.statusText) }],
          details: {},
        };
      }
      const data = (await res.json()) as Record<string, unknown>;
      return {
        content: [
          {
            type: "text",
            text: [
              "## 🔌 Obsidian Local REST API",
              "",
              `**Status**: ${data.status}`,
              `**Service**: ${data.service}`,
              `**Authenticated**: ${data.authenticated}`,
              "",
              "**Manifest**:",
              `  - Plugin: ${(data.manifest as Record<string, unknown>)?.name} v${(data.manifest as Record<string, unknown>)?.version}`,
              `  - Obsidian: v${(data.versions as Record<string, unknown>)?.obsidian}`,
              "",
              "**Available Endpoints**:",
              "  - `GET /` — API info",
              "  - `GET /vault/{path}` — Read file / List directory",
              "  - `PUT /vault/{path}` — Write file",
              "  - `POST /vault/{path}` — Append to file",
              "  - `DELETE /vault/{path}` — Delete file",
            ].join("\n"),
          },
        ],
        details: {},
      };
    },
  });

  // ── Tool: obsidian_create_note ──
  pi.registerTool({
    name: "obsidian_create_note",
    label: "Obsidian Create Note",
    description:
      "Create a new markdown note with frontmatter. Generates a unique filename if not specified. This is a convenience wrapper around obsidian_write.",
    parameters: Type.Object({
      title: Type.String({ description: "Note title (used as filename if path not given)" }),
      content: Type.String({ description: "Markdown body content" }),
      path: Type.Optional(
        Type.String({
          description:
            "Explicit file path, e.g. 'Folder/note.md'. If omitted, path is derived from title.",
        }),
      ),
      tags: Type.Optional(
        Type.Array(Type.String(), {
          description: "Optional frontmatter tags, e.g. ['pi', 'obsidian']",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (!hasApiKey()) return missingKeyResult();
      const filePath =
        params.path ??
        `${params.title.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, "-").replace(/^-|-$/g, "")}.md`;

      // Build frontmatter
      const frontmatter: string[] = ["---"];
      frontmatter.push(`title: "${params.title}"`);
      frontmatter.push(`created: ${new Date().toISOString().split("T")[0]}`);
      if (params.tags && params.tags.length > 0) {
        frontmatter.push(`tags:\n  - ${params.tags.join("\n  - ")}`);
      }
      frontmatter.push("---");

      const fullContent = `${frontmatter.join("\n")}\n\n${params.content}`;

      const res = await obsidianFetch(`/vault/${encodePath(filePath)}`, {
        method: "PUT",
        body: fullContent,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return {
          content: [{ type: "text", text: toolError(res.status, text || res.statusText) }],
          details: {},
        };
      }
      return {
        content: [{ type: "text", text: `✅ Created note \`${filePath}\`` }],
        details: { file: filePath },
      };
    },
  });

  // ── Tool: obsidian_list_vault ──
  pi.registerTool({
    name: "obsidian_list_vault",
    label: "Obsidian List Vault Root",
    description:
      "List the top-level contents of the Obsidian vault root directory. A quick way to see available folders and files.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      if (!hasApiKey()) return missingKeyResult();
      const res = await obsidianFetch("/vault/");
      if (!res.ok) {
        return {
          content: [{ type: "text", text: toolError(res.status, res.statusText) }],
          details: {},
        };
      }
      const json = (await res.json()) as { files: string[] };
      const formatted = formatFileList(json);
      return {
        content: [{ type: "text", text: formatted }],
        details: {},
      };
    },
  });

  // ── Command: /obsidian ──
  pi.registerCommand("obsidian", {
    description:
      "Obsidian vault management — use the obsidian_* tools to read/write/search notes.",
    handler: async (_args, ctx) => {
      ctx.ui.notify(
        "Use the obsidian_* tools in your conversation to interact with the vault.",
        "info",
      );
    },
  });
}
