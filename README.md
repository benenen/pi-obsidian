# pi-obsidian

An [Obsidian](https://obsidian.md) extension for the **pi** coding agent. It talks to
the [Obsidian Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api)
plugin so pi can read, write, search and manage notes in your vault.

## Install

```bash
# persisted (reads pi.extensions from package.json)
pi install <git-source-or-path>

# one-off, for the current session only
pi -e ./index.ts
```

On session start the extension pings the API and notifies whether the vault is
reachable.

## Configuration

Config is read from environment variables — **no secrets are baked into the
source**:

| Variable            | Default                     | Description                                         |
| ------------------- | --------------------------- | --------------------------------------------------- |
| `OBSIDIAN_API_URL`  | `http://127.0.0.1:27123`    | Base URL of the Local REST API plugin.              |
| `OBSIDIAN_API_KEY`  | *(empty — required)*        | Plugin API key; sent as the `Bearer` token.         |

Copy [`.env.example`](./.env.example) and fill in your own values, or export the
vars in your shell. Get the key from **Obsidian → Settings → Local REST API**.

If `OBSIDIAN_API_KEY` is unset (or blank/whitespace), the extension keeps
prompting you to set it: once at session start, and again from **every**
`obsidian_*` tool call — no network request is made until a key is configured.

## Tools (23)

**Vault files**

| Tool                    | Endpoint | What it does                                              |
| ----------------------- | -------- | -------------------------------------------------------- |
| `obsidian_read`         | `GET /vault/{path}`    | Read a file's full markdown content.       |
| `obsidian_write`        | `PUT /vault/{path}`    | Write/overwrite a file (creates parent dirs). |
| `obsidian_append`       | `POST /vault/{path}`   | Append to a file.                          |
| `obsidian_patch`        | `PATCH /vault/{path}`  | Insert relative to a heading/block/frontmatter field. |
| `obsidian_delete`       | `DELETE /vault/{path}` | Delete a file or empty folder.             |
| `obsidian_list`         | `GET /vault/{dir}/`    | List files/folders at a path.              |
| `obsidian_list_vault`   | `GET /vault/`          | List the vault root.                       |
| `obsidian_create_note`  | `PUT /vault/{path}`    | Create a note with frontmatter (convenience). |

**Active file** (the note currently open in Obsidian)

| Tool                     | Endpoint | What it does                    |
| ------------------------ | -------- | ------------------------------- |
| `obsidian_get_active`    | `GET /active/`    | Read the active file.  |
| `obsidian_update_active` | `PUT /active/`    | Overwrite the active file. |
| `obsidian_append_active` | `POST /active/`   | Append to the active file. |
| `obsidian_delete_active` | `DELETE /active/` | Delete the active file. |

**Periodic notes** (`daily`/`weekly`/`monthly`/`quarterly`/`yearly`)

| Tool                        | Endpoint | What it does                    |
| --------------------------- | -------- | ------------------------------- |
| `obsidian_periodic_get`     | `GET /periodic/{period}/`    | Read the current periodic note. |
| `obsidian_periodic_append`  | `POST /periodic/{period}/`   | Append to it (e.g. today's daily note). |
| `obsidian_periodic_update`  | `PUT /periodic/{period}/`    | Overwrite it. |
| `obsidian_periodic_delete`  | `DELETE /periodic/{period}/` | Delete it. |

**Search / tags / commands**

| Tool                       | Endpoint | What it does                    |
| -------------------------- | -------- | ------------------------------- |
| `obsidian_search_simple`   | `POST /search/simple/` | Full-text search with context. |
| `obsidian_search`          | `POST /search/`        | Advanced query — a JsonLogic expression over each note's metadata (frontmatter/tags/path/content). |
| `obsidian_list_tags`       | `GET /tags/`           | List all tags with usage counts. |
| `obsidian_list_commands`   | `GET /commands/`       | List runnable Obsidian commands. |
| `obsidian_execute_command` | `POST /commands/{id}/` | Run a command by id. |
| `obsidian_open`            | `POST /open/{path}`    | Open a file in the Obsidian UI. |
| `obsidian_info`            | `GET /`                | Show API version + auth status. |

### Command

`/obsidian <instruction>` — routes your instruction to the agent and steers it to
use the `obsidian_*` tools (e.g. `/obsidian list my vault`, `/obsidian append
today's todos to the daily note`). With no argument it prints usage.

### Not exposed as tools

The dated periodic variants (`/periodic/{period}/{y}/{m}/{d}/`), `PATCH` on
`/active/` and `/periodic/`, and the server/transport endpoints (`/mcp/`,
`/obsidian-local-rest-api.crt`, `/openapi.yaml`) are intentionally omitted.

## Development

```bash
npm install       # install dev deps (types + tsx + typescript)
npm run typecheck  # tsc --noEmit against index.ts
npm test           # node:test mock suite (test/*.test.ts)
```

The tests mock `pi` (the ExtensionAPI) and the global `fetch`, so they run fully
offline — no vault or network required. `pi` loads `index.ts` directly via its
own type-stripping loader, so `npm run typecheck` is what actually catches type
errors.
