import { vi } from "vitest";
import { handle } from "../src/background/handlers.js";

// A pretend browser for the tests: storage, tabs, scripting, permissions and messages to the
// service worker (which runs for real, with fetch replaced).
export function fakeChrome({ tab = { id: 7, url: "https://www.example.com/pork-roast", title: "Pork Roast | Example", favIconUrl: "https://www.example.com/favicon.ico" }, page = {}, stored = {}, allow = true, fetch, bubble = false } = {}) {
  const store = { ...stored };
  const onPage = { bubble, banners: [] }; // the floating bubble on the tab, and the banners shown at its top
  const opened = [];
  const granted = new Set(allow ? ["http://192.168.1.20:5173/*"] : []); // sites the extension may read
  const registered = new Map(); // content scripts set to load on sites by themselves
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
      registerContentScripts: vi.fn(async (list) => list.forEach((c) => registered.set(c.id, c))),
      unregisterContentScripts: vi.fn(async (f) => (f?.ids ?? [...registered.keys()]).forEach((id) => registered.delete(id))),
      getRegisteredContentScripts: vi.fn(async (f) => [...registered.values()].filter((c) => !f?.ids || f.ids.includes(c.id))),
      executeScript: vi.fn(async ({ files, func, args }) => {
        // like Chrome: what's passed into the page must be JSON (undefined isn't)
        if (args?.some((a) => a === undefined)) throw new Error("Error in invocation of scripting.executeScript: Value is unserializable.");
        if (page instanceof Error) throw page;
        if (files) return (onPage.bubble = true), [{ result: undefined }];
        if (func?.name === "bubbleHere") return [{ result: onPage.bubble }];
        if (func?.name === "hideBubble") return (onPage.bubble = false), [{ result: undefined }];
        if (func?.name === "showBanner") return onPage.banners.push(args), [{ result: undefined }];
        return [{ result: page }];
      }),
    },
    permissions: {
      request: vi.fn(async ({ origins }) => (allow ? (origins.forEach((o) => granted.add(o)), true) : false)),
      contains: vi.fn(async ({ origins }) => allow && origins.every((o) => granted.has(o) || /^http:\/\/192\.168/.test(o))),
      remove: vi.fn(async ({ origins }) => (origins.forEach((o) => granted.delete(o)), true)),
      onRemoved: { addListener: vi.fn() },
    },
    runtime: {
      sendMessage: vi.fn((msg) => handle(msg, { chrome, fetch, sender: { id: "ext" } })),
      openOptionsPage: vi.fn(),
      onMessage: { addListener: vi.fn() },
    },
  };
  globalThis.chrome = chrome;
  return { chrome, store, opened, onPage, granted, registered };
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
