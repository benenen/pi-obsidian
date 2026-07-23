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
If `OBSIDIAN_API_KEY` is unset, the extension warns at session start and API
calls will fail with `401`.

## Tools

| Tool                    | What it does                                                        |
| ----------------------- | ------------------------------------------------------------------ |
| `obsidian_read`         | Read a file's full markdown content.                               |
| `obsidian_write`        | Write/overwrite a file (creates parent dirs).                      |
| `obsidian_append`       | Append to an existing file.                                        |
| `obsidian_delete`       | Delete a file or empty folder.                                     |
| `obsidian_list`         | List files/folders at a path.                                     |
| `obsidian_list_vault`   | List the vault root.                                              |
| `obsidian_info`         | Show API version + auth status.                                   |
| `obsidian_create_note`  | Create a note with frontmatter (title / tags / auto filename).    |

Command: `/obsidian` — quick hint on how to use the tools.

## API endpoints used

| Method   | Path            | Purpose                    |
| -------- | --------------- | -------------------------- |
| `GET`    | `/`             | API info / auth status     |
| `GET`    | `/vault/{path}` | Read file or list directory |
| `PUT`    | `/vault/{path}` | Write/create a file        |
| `POST`   | `/vault/{path}` | Append to a file           |
| `DELETE` | `/vault/{path}` | Delete a file or folder    |
