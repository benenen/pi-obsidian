/**
 * Shared test helpers: a mock ExtensionAPI that captures registrations, a mock
 * ExtensionContext that records notifications, and a fetch stub.
 *
 * IMPORTANT: this module must NOT import ../index.ts. Test files set env vars,
 * then dynamically `await import("../index.ts")` so the extension reads the env
 * at load time. A static import here (evaluated before that env is set) would
 * bake in the wrong config.
 */

export interface RegisteredToolLike {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute: (
    toolCallId: string,
    params: any,
    signal: unknown,
    onUpdate: unknown,
    ctx: unknown,
  ) => Promise<{ content: Array<{ type: string; text: string }>; details: any }>;
}

export interface MockPi {
  pi: any;
  tools: Map<string, RegisteredToolLike>;
  commands: Map<string, any>;
  handlers: Map<string, (event: any, ctx: any) => any>;
  /** User messages the extension injected via pi.sendUserMessage(). */
  userMessages: any[];
}

/** A mock ExtensionAPI that records everything the extension registers. */
export function makeMockPi(): MockPi {
  const tools = new Map<string, RegisteredToolLike>();
  const commands = new Map<string, any>();
  const handlers = new Map<string, (event: any, ctx: any) => any>();
  const userMessages: any[] = [];
  const pi: any = {
    on: (event: string, handler: any) => handlers.set(event, handler),
    registerTool: (tool: any) => tools.set(tool.name, tool),
    registerCommand: (name: string, opts: any) => commands.set(name, opts),
    registerShortcut: () => {},
    registerFlag: () => {},
    sendUserMessage: (content: any) => userMessages.push(content),
    sendMessage: () => {},
  };
  return { pi, tools, commands, handlers, userMessages };
}

export interface Notification {
  message: string;
  level: string;
}

/** A mock ExtensionContext whose ui.notify() pushes into a captured array. */
export function makeCtx(): { ctx: any; notifications: Notification[] } {
  const notifications: Notification[] = [];
  const ctx: any = {
    ui: {
      notify: (message: string, level: string) =>
        notifications.push({ message, level }),
    },
  };
  return { ctx, notifications };
}

export interface FetchCall {
  url: string;
  options: any;
}

export type Responder = (url: string, options: any) => Response | Promise<Response>;

/** Replace globalThis.fetch with a stub; returns recorded calls + a restore(). */
export function installFetch(responder: Responder): {
  calls: FetchCall[];
  restore: () => void;
} {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : String(input?.url ?? input);
    const options = init ?? {};
    calls.push({ url, options });
    return responder(url, options);
  }) as unknown as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function textResponse(text: string, status = 200, statusText = "OK"): Response {
  return new Response(text, { status, statusText });
}
