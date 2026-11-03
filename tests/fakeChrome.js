import { vi } from "vitest";
import { handle } from "../src/background/handlers.js";

// A pretend browser for the tests: storage, tabs, scripting, permissions and messages to the
// service worker (which runs for real, with fetch replaced).
export function fakeChrome({ tab = { id: 7, url: "https://www.example.com/pork-roast", title: "Pork Roast | Example", favIconUrl: "https://www.example.com/favicon.ico" }, page = {}, stored = {}, allow = true, fetch } = {}) {
  const store = { ...stored };
  const opened = [];
  const chrome = {
    storage: {
      local: {
        get: vi.fn(async (defaults) => ({ ...defaults, ...Object.fromEntries(Object.keys(defaults).filter((k) => k in store).map((k) => [k, store[k]])) })),
        set: vi.fn(async (v) => Object.assign(store, v)),
      },
    },
    tabs: {
      query: vi.fn(async () => [tab]),
      create: vi.fn(async ({ url }) => opened.push(url)),
    },
    scripting: {
      executeScript: vi.fn(async () => {
        if (page instanceof Error) throw page;
        return [{ result: page }];
      }),
    },
    permissions: {
      request: vi.fn(async () => allow),
      contains: vi.fn(async () => allow),
    },
    runtime: {
      sendMessage: vi.fn((msg) => handle(msg, { chrome, fetch })),
      openOptionsPage: vi.fn(),
      onMessage: { addListener: vi.fn() },
    },
  };
  globalThis.chrome = chrome;
  return { chrome, store, opened };
}

export const answer = (status, json) => Promise.resolve(new Response(json === undefined ? null : JSON.stringify(json), { status, headers: { "content-type": "application/json" } }));
export const tick = () => new Promise((r) => setTimeout(r, 0));
export async function until(fn, ms = 1000) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      return fn();
    } catch (e) {
      if (Date.now() > end) throw e;
      await new Promise((r) => setTimeout(r, 10));
    }
  }
}
