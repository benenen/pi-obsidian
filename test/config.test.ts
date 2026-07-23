/**
 * Mock tests for the "no API key configured" path.
 *
 * Runs in its own file (its own process under `node --test`) so the extension
 * is loaded fresh with OBSIDIAN_API_KEY unset. The extension must keep
 * prompting the user to set the key: at session start AND on every tool call.
 */
process.env.OBSIDIAN_API_URL = "http://obsidian.test:27123";
delete process.env.OBSIDIAN_API_KEY;

import { test } from "node:test";
import assert from "node:assert/strict";
import { makeMockPi, makeCtx, installFetch } from "./helpers.ts";

const factory = (await import("../index.ts")).default;

function setup() {
  const m = makeMockPi();
  factory(m.pi);
  return m;
}

test("session_start warns to set OBSIDIAN_API_KEY and never calls the API", async () => {
  const m = setup();
  const { calls, restore } = installFetch(() => new Response("{}"));
  const { ctx, notifications } = makeCtx();
  try {
    await m.handlers.get("session_start")!(
      { type: "session_start", reason: "startup" },
      ctx,
    );
    assert.equal(calls.length, 0);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].level, "warning");
    assert.match(notifications[0].message, /OBSIDIAN_API_KEY is not set/);
  } finally {
    restore();
  }
});

test("every tool re-prompts to set the key and makes no request", async () => {
  const m = setup();
  const { calls, restore } = installFetch(() => new Response("{}"));
  const { ctx } = makeCtx();
  const paramsByTool: Record<string, any> = {
    obsidian_read: { path: "a.md" },
    obsidian_write: { path: "a.md", content: "x" },
    obsidian_append: { path: "a.md", content: "x" },
    obsidian_delete: { path: "a.md" },
    obsidian_list: {},
    obsidian_list_vault: {},
    obsidian_info: {},
    obsidian_create_note: { title: "t", content: "c" },
  };
  try {
    for (const [name, params] of Object.entries(paramsByTool)) {
      const res = await m.tools
        .get(name)!
        .execute("id", params, undefined, undefined, ctx);
      assert.match(
        res.content[0].text,
        /OBSIDIAN_API_KEY is not set/,
        `${name} should prompt to set the key`,
      );
    }
    assert.equal(calls.length, 0, "no tool should hit the network without a key");
  } finally {
    restore();
  }
});

test("a whitespace-only key still counts as missing", async () => {
  // Reload the module with a blank key via a cache-busting query specifier.
  process.env.OBSIDIAN_API_KEY = "   ";
  const mod = await import("../index.ts?whitespace-key");
  const m = makeMockPi();
  mod.default(m.pi);
  const { calls, restore } = installFetch(() => new Response("{}"));
  const { ctx } = makeCtx();
  try {
    const res = await m.tools
      .get("obsidian_read")!
      .execute("id", { path: "a.md" }, undefined, undefined, ctx);
    assert.match(res.content[0].text, /OBSIDIAN_API_KEY is not set/);
    assert.equal(calls.length, 0);
  } finally {
    restore();
    delete process.env.OBSIDIAN_API_KEY;
  }
});
