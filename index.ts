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

// A successful text tool-result.
function okResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

// An error tool-result built from a failed Response (body preferred over status text).
async function errResult(res: Response) {
  const body = await res.text().catch(() => "");
  return {
    content: [
      { type: "text" as const, text: toolError(res.status, body || res.statusText) },
    ],
    details: {},
  };
}

// TypeBox enums shared by several tools.
const PeriodType = Type.Union(
  [
    Type.Literal("daily"),
    Type.Literal("weekly"),
    Type.Literal("monthly"),
    Type.Literal("quarterly"),
    Type.Literal("yearly"),
  ],
  { description: "Which periodic note to target." },
);

const OperationType = Type.Union(
  [Type.Literal("append"), Type.Literal("prepend"), Type.Literal("replace")],
  { description: "How to apply the patch relative to the target." },
);

const TargetTypeType = Type.Union(
  [Type.Literal("heading"), Type.Literal("block"), Type.Literal("frontmatter")],
  { description: "What kind of section the target refers to." },
);

// Build the Obsidian PATCH headers from tool params. The Target header must be
// URL-encoded (required for non-ASCII), and the content-type defaults by target.
function buildPatchHeaders(p: {
  operation: string;
  targetType: string;
  target: string;
  targetDelimiter?: string;
  createTargetIfMissing?: boolean;
  trimTargetWhitespace?: boolean;
}): Record<string, string> {
  const headers: Record<string, string> = {
    Operation: p.operation,
    "Target-Type": p.targetType,
    Target: encodeURIComponent(p.target),
    "Content-Type":
      p.targetType === "frontmatter" ? "application/json" : "text/markdown",
  };
  if (p.targetDelimiter) headers["Target-Delimiter"] = p.targetDelimiter;
  if (p.createTargetIfMissing !== undefined) {
    headers["Create-Target-If-Missing"] = String(p.createTargetIfMissing);
  }
  if (p.trimTargetWhitespace !== undefined) {
    headers["Trim-Target-Whitespace"] = String(p.trimTargetWhitespace);
  }
  return headers;
}

function formatTags(json: { tags?: Array<{ name: string; count: number }> }): string {
  const tags = json.tags ?? [];
  if (tags.length === 0) return "*(no tags)*";
  const lines = tags.map((t) => `- #${t.name} (${t.count})`);
  return `**${tags.length} tags**\n\n${lines.join("\n")}`;
}

function formatCommands(json: Array<{ id: string; name: string }>): string {
  if (!Array.isArray(json) || json.length === 0) return "*(no commands)*";
  const lines = json.map((c) => `- \`${c.id}\` — ${c.name}`);
  return `**${json.length} commands**\n\n${lines.join("\n")}`;
}

function formatSearchSimple(
  json: Array<{ filename: string; matches?: unknown[] }>,
): string {
  if (!Array.isArray(json) || json.length === 0) return "*(no matches)*";
  const lines = json.map(
    (r) => `- ${r.filename}${r.matches ? ` (${r.matches.length} matches)` : ""}`,
  );
  return `**${json.length} results**\n\n${lines.join("\n")}`;
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

  // ── Tool: obsidian_patch ──
  pi.registerTool({
    name: "obsidian_patch",
    label: "Obsidian Patch",
    description:
      "Insert content into an existing note relative to a heading, block reference, or frontmatter field. Use this for structured edits instead of overwriting the whole file.",
    parameters: Type.Object({
      path: Type.String({ description: "File path relative to vault root." }),
      operation: OperationType,
      targetType: TargetTypeType,
      target: Type.String({
        description:
          "The section to target: a heading (optionally nested with the delimiter), a block reference id, or a frontmatter field name.",
      }),
      content: Type.String({
        description:
          "Content to insert. Markdown for heading/block targets; a JSON value for frontmatter targets.",
      }),
      targetDelimiter: Type.Optional(
        Type.String({ description: 'Nested-heading delimiter (default "::").' }),
      ),
      createTargetIfMissing: Type.Optional(
        Type.Boolean({ description: "Create the target if it does not exist." }),
      ),
      trimTargetWhitespace: Type.Optional(
        Type.Boolean({ description: "Trim whitespace from the target content." }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (!hasApiKey()) return missingKeyResult();
      const res = await obsidianFetch(`/vault/${encodePath(params.path)}`, {
        method: "PATCH",
        headers: buildPatchHeaders(params),
        body: params.content,
      });
      if (!res.ok) return errResult(res);
      return okResult(`✅ Patched \`${params.path}\` (${params.operation} → ${params.targetType} "${params.target}")`);
    },
  });

  // ── Tool: obsidian_get_active ──
  pi.registerTool({
    name: "obsidian_get_active",
    label: "Obsidian Get Active File",
    description:
      "Read the content of the file currently open/active in Obsidian. Returns markdown text.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      if (!hasApiKey()) return missingKeyResult();
      const res = await obsidianFetch("/active/");
      if (!res.ok) return errResult(res);
      return okResult(await res.text());
    },
  });

  // ── Tool: obsidian_update_active ──
  pi.registerTool({
    name: "obsidian_update_active",
    label: "Obsidian Update Active File",
    description:
      "Overwrite the content of the file currently open/active in Obsidian.",
    parameters: Type.Object({
      content: Type.String({ description: "Full markdown content to write." }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (!hasApiKey()) return missingKeyResult();
      const res = await obsidianFetch("/active/", {
        method: "PUT",
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
        body: params.content,
      });
      if (!res.ok) return errResult(res);
      return okResult("✅ Updated the active file");
    },
  });

  // ── Tool: obsidian_append_active ──
  pi.registerTool({
    name: "obsidian_append_active",
    label: "Obsidian Append Active File",
    description:
      "Append content to the end of the file currently open/active in Obsidian.",
    parameters: Type.Object({
      content: Type.String({ description: "Content to append." }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (!hasApiKey()) return missingKeyResult();
      const res = await obsidianFetch("/active/", {
        method: "POST",
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
        body: params.content,
      });
      if (!res.ok) return errResult(res);
      return okResult("✅ Appended to the active file");
    },
  });

  // ── Tool: obsidian_delete_active ──
  pi.registerTool({
    name: "obsidian_delete_active",
    label: "Obsidian Delete Active File",
    description:
      "Delete the file currently open/active in Obsidian. Use with caution — this is permanent.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      if (!hasApiKey()) return missingKeyResult();
      const res = await obsidianFetch("/active/", { method: "DELETE" });
      if (!res.ok) return errResult(res);
      return okResult("✅ Deleted the active file");
    },
  });

  // ── Tool: obsidian_search_simple ──
  pi.registerTool({
    name: "obsidian_search_simple",
    label: "Obsidian Search (text)",
    description:
      "Full-text search across the vault for a plain-text query. Returns matching files with surrounding context.",
    parameters: Type.Object({
      query: Type.String({ description: "Text to search for." }),
      contextLength: Type.Optional(
        Type.Number({
          description: "Characters of context to include around each match (default 100).",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (!hasApiKey()) return missingKeyResult();
      const qs = new URLSearchParams({ query: params.query });
      if (params.contextLength !== undefined) {
        qs.set("contextLength", String(params.contextLength));
      }
      const res = await obsidianFetch(`/search/simple/?${qs.toString()}`, {
        method: "POST",
      });
      if (!res.ok) return errResult(res);
      return okResult(formatSearchSimple(await res.json()));
    },
  });

  // ── Tool: obsidian_search ──
  pi.registerTool({
    name: "obsidian_search",
    label: "Obsidian Search (advanced)",
    description:
      "Run an advanced query against every file in the vault, using either a Dataview DQL query or a JsonLogic query. Returns the raw JSON result.",
    parameters: Type.Object({
      query: Type.String({
        description:
          "The query. For 'jsonlogic', a JSON string; for 'dataview', a DQL query string.",
      }),
      format: Type.Optional(
        Type.Union([Type.Literal("jsonlogic"), Type.Literal("dataview")], {
          description: "Query language (default 'jsonlogic').",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (!hasApiKey()) return missingKeyResult();
      const format = params.format ?? "jsonlogic";
      const contentType =
        format === "dataview"
          ? "application/vnd.olrapi.dataview.dql+txt"
          : "application/vnd.olrapi.jsonlogic+json";
      const res = await obsidianFetch("/search/", {
        method: "POST",
        headers: { "Content-Type": contentType },
        body: params.query,
      });
      if (!res.ok) return errResult(res);
      const data = await res.json();
      return okResult(`\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``);
    },
  });

  // ── Tool: obsidian_list_tags ──
  pi.registerTool({
    name: "obsidian_list_tags",
    label: "Obsidian List Tags",
    description:
      "List all tags used across the vault with the number of times each is used.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      if (!hasApiKey()) return missingKeyResult();
      const res = await obsidianFetch("/tags/");
      if (!res.ok) return errResult(res);
      return okResult(formatTags(await res.json()));
    },
  });

  // ── Tool: obsidian_list_commands ──
  pi.registerTool({
    name: "obsidian_list_commands",
    label: "Obsidian List Commands",
    description:
      "List the Obsidian commands available to run (each has an id and a display name).",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      if (!hasApiKey()) return missingKeyResult();
      const res = await obsidianFetch("/commands/");
      if (!res.ok) return errResult(res);
      const data = await res.json();
      const commands = (data as { commands?: unknown }).commands ?? data;
      return okResult(formatCommands(commands as Array<{ id: string; name: string }>));
    },
  });

  // ── Tool: obsidian_execute_command ──
  pi.registerTool({
    name: "obsidian_execute_command",
    label: "Obsidian Execute Command",
    description:
      "Execute an Obsidian command by its id (get ids from obsidian_list_commands).",
    parameters: Type.Object({
      commandId: Type.String({ description: "The command id, e.g. 'editor:toggle-bold'." }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (!hasApiKey()) return missingKeyResult();
      const res = await obsidianFetch(
        `/commands/${encodePath(params.commandId)}/`,
        { method: "POST" },
      );
      if (!res.ok) return errResult(res);
      return okResult(`✅ Executed command \`${params.commandId}\``);
    },
  });

  // ── Tool: obsidian_open ──
  pi.registerTool({
    name: "obsidian_open",
    label: "Obsidian Open File",
    description:
      "Open a file in the Obsidian UI (creates it if it does not exist).",
    parameters: Type.Object({
      path: Type.String({ description: "File path relative to vault root." }),
      newLeaf: Type.Optional(
        Type.Boolean({ description: "Open in a new pane/leaf (default false)." }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (!hasApiKey()) return missingKeyResult();
      const qs = params.newLeaf ? "?newLeaf=true" : "";
      const res = await obsidianFetch(`/open/${encodePath(params.path)}${qs}`, {
        method: "POST",
      });
      if (!res.ok) return errResult(res);
      return okResult(`✅ Opened \`${params.path}\` in Obsidian`);
    },
  });

  // ── Tool: obsidian_periodic_get ──
  pi.registerTool({
    name: "obsidian_periodic_get",
    label: "Obsidian Get Periodic Note",
    description:
      "Read the current periodic note (daily/weekly/monthly/quarterly/yearly). Returns markdown text.",
    parameters: Type.Object({ period: PeriodType }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (!hasApiKey()) return missingKeyResult();
      const res = await obsidianFetch(`/periodic/${params.period}/`);
      if (!res.ok) return errResult(res);
      return okResult(await res.text());
    },
  });

  // ── Tool: obsidian_periodic_append ──
  pi.registerTool({
    name: "obsidian_periodic_append",
    label: "Obsidian Append Periodic Note",
    description:
      "Append content to the current periodic note (e.g. add a line to today's daily note).",
    parameters: Type.Object({
      period: PeriodType,
      content: Type.String({ description: "Content to append." }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (!hasApiKey()) return missingKeyResult();
      const res = await obsidianFetch(`/periodic/${params.period}/`, {
        method: "POST",
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
        body: params.content,
      });
      if (!res.ok) return errResult(res);
      return okResult(`✅ Appended to the current ${params.period} note`);
    },
  });

  // ── Tool: obsidian_periodic_update ──
  pi.registerTool({
    name: "obsidian_periodic_update",
    label: "Obsidian Update Periodic Note",
    description: "Overwrite the content of the current periodic note.",
    parameters: Type.Object({
      period: PeriodType,
      content: Type.String({ description: "Full markdown content to write." }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (!hasApiKey()) return missingKeyResult();
      const res = await obsidianFetch(`/periodic/${params.period}/`, {
        method: "PUT",
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
        body: params.content,
      });
      if (!res.ok) return errResult(res);
      return okResult(`✅ Updated the current ${params.period} note`);
    },
  });

  // ── Tool: obsidian_periodic_delete ──
  pi.registerTool({
    name: "obsidian_periodic_delete",
    label: "Obsidian Delete Periodic Note",
    description:
      "Delete the current periodic note. Use with caution — this is permanent.",
    parameters: Type.Object({ period: PeriodType }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (!hasApiKey()) return missingKeyResult();
      const res = await obsidianFetch(`/periodic/${params.period}/`, {
        method: "DELETE",
      });
      if (!res.ok) return errResult(res);
      return okResult(`✅ Deleted the current ${params.period} note`);
    },
  });

  // ── Command: /obsidian [instruction] ──
  // With an argument, route the instruction to the agent and steer it to use
  // the obsidian_* tools. With no argument, show usage.
  pi.registerCommand("obsidian", {
    description:
      "Act on your Obsidian vault. Usage: /obsidian <instruction> — e.g. " +
      "`/obsidian list my vault` or `/obsidian create a note 'Ideas' with today's todos`.",
    handler: async (args, ctx) => {
      const intent = args.trim();
      if (!intent) {
        ctx.ui.notify(
          "Usage: /obsidian <instruction> — e.g. `/obsidian list my vault` " +
            "or `/obsidian save this note to Notes/idea.md`.",
          "info",
        );
        return;
      }
      pi.sendUserMessage(
        "Use the Obsidian vault tools (the obsidian_* tools) to handle the " +
          "following request. Chain multiple tools if needed (e.g. list/read " +
          `before writing). Request:\n\n${intent}`,
      );
    },
  });
}
