/**
 * Mock tests for the Obsidian extension with a configured API key.
 *
 * Env is set BEFORE the extension is imported (it reads OBSIDIAN_* at load
 * time), so the import is dynamic and must come after these assignments.
 */
process.env.OBSIDIAN_API_URL = "http://obsidian.test:27123";
process.env.OBSIDIAN_API_KEY = "test-key-123";

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeMockPi,
  makeCtx,
  installFetch,
  jsonResponse,
  textResponse,
} from "./helpers.ts";

const factory = (await import("../index.ts")).default;

const BASE = "http://obsidian.test:27123";
const AUTH = "Bearer test-key-123";

/** Register the extension into a fresh mock and return the captured maps. */
function setup() {
  const m = makeMockPi();
  factory(m.pi);
  return m;
}

test("registers all tools, the /obsidian command, and a session_start handler", () => {
  const m = setup();
  assert.deepEqual(
    [...m.tools.keys()].sort(),
    [
      "obsidian_append",
      "obsidian_create_note",
      "obsidian_delete",
      "obsidian_info",
      "obsidian_list",
      "obsidian_list_vault",
      "obsidian_read",
      "obsidian_write",
    ],
  );
  assert.ok(m.commands.has("obsidian"));
  assert.ok(m.handlers.has("session_start"));
});

test("obsidian_read: GETs the per-segment-encoded path with auth and returns text", async () => {
  const m = setup();
  const { calls, restore } = installFetch(() => textResponse("# Hello\n\nbody"));
  const { ctx } = makeCtx();
  try {
    const res = await m.tools
      .get("obsidian_read")!
      .execute("id", { path: "日 记/note.md" }, undefined, undefined, ctx);
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      `${BASE}/vault/${encodeURIComponent("日 记")}/${encodeURIComponent("note.md")}`,
    );
    assert.equal(calls[0].options.method, undefined); // GET
    assert.equal(calls[0].options.headers.Authorization, AUTH);
    assert.equal(res.content[0].text, "# Hello\n\nbody");
    assert.deepEqual(res.details, { file: "日 记/note.md" });
  } finally {
    restore();
  }
});

test("obsidian_read: non-ok surfaces a formatted error with the body", async () => {
  const m = setup();
  const { restore } = installFetch(() => textResponse("no such file", 404, "Not Found"));
  const { ctx } = makeCtx();
  try {
    const res = await m.tools
      .get("obsidian_read")!
      .execute("id", { path: "missing.md" }, undefined, undefined, ctx);
    assert.match(res.content[0].text, /Error 404/);
    assert.match(res.content[0].text, /no such file/);
  } finally {
    restore();
  }
});

test("obsidian_write: PUTs the raw body and confirms the path", async () => {
  const m = setup();
  const { calls, restore } = installFetch(() => textResponse("", 200));
  const { ctx } = makeCtx();
  try {
    const res = await m.tools
      .get("obsidian_write")!
      .execute("id", { path: "a/b.md", content: "CONTENT" }, undefined, undefined, ctx);
    assert.equal(calls[0].url, `${BASE}/vault/a/b.md`);
    assert.equal(calls[0].options.method, "PUT");
    assert.equal(calls[0].options.body, "CONTENT");
    assert.equal(calls[0].options.headers.Authorization, AUTH);
    assert.match(res.content[0].text, /Written to `a\/b.md`/);
  } finally {
    restore();
  }
});

test("obsidian_append: POSTs with the markdown content-type", async () => {
  const m = setup();
  const { calls, restore } = installFetch(() => textResponse("", 200));
  const { ctx } = makeCtx();
  try {
    const res = await m.tools
      .get("obsidian_append")!
      .execute("id", { path: "n.md", content: "more" }, undefined, undefined, ctx);
    assert.equal(calls[0].options.method, "POST");
    assert.equal(calls[0].options.body, "more");
    assert.equal(
      calls[0].options.headers["Content-Type"],
      "text/markdown; charset=utf-8",
    );
    assert.equal(calls[0].options.headers.Authorization, AUTH);
    assert.match(res.content[0].text, /Appended to `n.md`/);
  } finally {
    restore();
  }
});

test("obsidian_delete: sends DELETE and confirms", async () => {
  const m = setup();
  const { calls, restore } = installFetch(() => textResponse("", 200));
  const { ctx } = makeCtx();
  try {
    const res = await m.tools
      .get("obsidian_delete")!
      .execute("id", { path: "trash.md" }, undefined, undefined, ctx);
    assert.equal(calls[0].options.method, "DELETE");
    assert.match(res.content[0].text, /Deleted `trash.md`/);
  } finally {
    restore();
  }
});

test("obsidian_list: lists a subdir and formats folders/files", async () => {
  const m = setup();
  const { calls, restore } = installFetch(() =>
    jsonResponse({ files: ["sub/", "a.md", "b.md"] }),
  );
  const { ctx } = makeCtx();
  try {
    const res = await m.tools
      .get("obsidian_list")!
      .execute("id", { path: "folder" }, undefined, undefined, ctx);
    assert.equal(calls[0].url, `${BASE}/vault/folder`);
    const text = res.content[0].text;
    assert.match(text, /3 items/);
    assert.match(text, /📁 \*\*sub\/\*\*/);
    assert.match(text, /📄 a\.md/);
  } finally {
    restore();
  }
});

test("obsidian_list: omitted path lists the vault root and reports empty", async () => {
  const m = setup();
  const { calls, restore } = installFetch(() => jsonResponse({ files: [] }));
  const { ctx } = makeCtx();
  try {
    const res = await m.tools
      .get("obsidian_list")!
      .execute("id", {}, undefined, undefined, ctx);
    assert.equal(calls[0].url, `${BASE}/vault/`);
    assert.match(res.content[0].text, /empty directory/);
  } finally {
    restore();
  }
});

test("obsidian_info: parses status, auth and manifest versions", async () => {
  const m = setup();
  const { calls, restore } = installFetch(() =>
    jsonResponse({
      status: "OK",
      service: "Obsidian Local REST API",
      authenticated: true,
      manifest: { name: "Local REST API", version: "4.1.7" },
      versions: { obsidian: "1.12.7" },
    }),
  );
  const { ctx } = makeCtx();
  try {
    const res = await m.tools
      .get("obsidian_info")!
      .execute("id", {}, undefined, undefined, ctx);
    assert.equal(calls[0].url, `${BASE}/`);
    const t = res.content[0].text;
    assert.match(t, /Status.*OK/);
    assert.match(t, /Authenticated.*true/);
    assert.match(t, /Local REST API v4\.1\.7/);
    assert.match(t, /Obsidian: v1\.12\.7/);
  } finally {
    restore();
  }
});

test("obsidian_create_note: derives a slug filename and builds frontmatter", async () => {
  const m = setup();
  const { calls, restore } = installFetch(() => textResponse("", 200));
  const { ctx } = makeCtx();
  try {
    const res = await m.tools.get("obsidian_create_note")!.execute(
      "id",
      { title: "My Note! 测试", content: "body text", tags: ["pi", "obsidian"] },
      undefined,
      undefined,
      ctx,
    );
    assert.equal(
      calls[0].url,
      `${BASE}/vault/${encodeURIComponent("my-note-测试.md")}`,
    );
    assert.equal(calls[0].options.method, "PUT");
    const body = calls[0].options.body as string;
    assert.match(body, /^---\n/);
    assert.match(body, /title: "My Note! 测试"/);
    assert.match(body, /created: \d{4}-\d{2}-\d{2}/);
    assert.match(body, /tags:\n {2}- pi\n {2}- obsidian/);
    assert.match(body, /\n\nbody text$/);
    assert.deepEqual(res.details, { file: "my-note-测试.md" });
  } finally {
    restore();
  }
});

test("obsidian_create_note: honors an explicit path and omits tags when none", async () => {
  const m = setup();
  const { calls, restore } = installFetch(() => textResponse("", 200));
  const { ctx } = makeCtx();
  try {
    await m.tools.get("obsidian_create_note")!.execute(
      "id",
      { title: "Daily", content: "hi", path: "Journal/2026-07-23.md" },
      undefined,
      undefined,
      ctx,
    );
    assert.equal(calls[0].url, `${BASE}/vault/Journal/2026-07-23.md`);
    const body = calls[0].options.body as string;
    assert.doesNotMatch(body, /tags:/);
    assert.match(body, /title: "Daily"/);
  } finally {
    restore();
  }
});

test("obsidian_list_vault: GETs /vault/ and formats the listing", async () => {
  const m = setup();
  const { calls, restore } = installFetch(() =>
    jsonResponse({ files: ["Inbox/", "readme.md"] }),
  );
  const { ctx } = makeCtx();
  try {
    const res = await m.tools
      .get("obsidian_list_vault")!
      .execute("id", {}, undefined, undefined, ctx);
    assert.equal(calls[0].url, `${BASE}/vault/`);
    assert.match(res.content[0].text, /2 items/);
    assert.match(res.content[0].text, /📁 \*\*Inbox\/\*\*/);
  } finally {
    restore();
  }
});

test("session_start: notifies 'connected' when the API responds ok", async () => {
  const m = setup();
  const { calls, restore } = installFetch(() => textResponse("{}", 200));
  const { ctx, notifications } = makeCtx();
  try {
    await m.handlers.get("session_start")!(
      { type: "session_start", reason: "startup" },
      ctx,
    );
    assert.equal(calls[0].url, `${BASE}/`);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].level, "info");
    assert.match(notifications[0].message, /connected/);
  } finally {
    restore();
  }
});

test("session_start: warns with the status when the API responds non-ok", async () => {
  const m = setup();
  const { restore } = installFetch(() => textResponse("", 401, "Unauthorized"));
  const { ctx, notifications } = makeCtx();
  try {
    await m.handlers.get("session_start")!(
      { type: "session_start", reason: "startup" },
      ctx,
    );
    assert.equal(notifications[0].level, "warning");
    assert.match(notifications[0].message, /401/);
  } finally {
    restore();
  }
});

test("session_start: reports 'unreachable' when fetch throws", async () => {
  const m = setup();
  const { restore } = installFetch(() => {
    throw new Error("ECONNREFUSED");
  });
  const { ctx, notifications } = makeCtx();
  try {
    await m.handlers.get("session_start")!(
      { type: "session_start", reason: "startup" },
      ctx,
    );
    assert.equal(notifications[0].level, "error");
    assert.match(notifications[0].message, /unreachable/);
  } finally {
    restore();
  }
});

test("/obsidian command notifies how to use the tools", async () => {
  const m = setup();
  const { ctx, notifications } = makeCtx();
  await m.commands.get("obsidian").handler("", ctx);
  assert.equal(notifications.length, 1);
  assert.match(notifications[0].message, /obsidian_/);
});
