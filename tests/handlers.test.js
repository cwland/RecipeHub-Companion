import { describe, expect, it, vi } from "vitest";
import { answer, fakeChrome } from "./fakeChrome.js";
import { handle } from "../src/background/handlers.js";
import { readPage } from "../src/lib/page.js";

// The bubble on the page asks the service worker; the worker reads the page and talks to RecipeHub
const stored = { address: "http://192.168.1.20:5173", key: "cul_inbox", importKey: "cul_import9" };
const tab = { id: 7, url: "https://www.example.com/pork-roast", title: "Pork Roast | Example", favIconUrl: "https://www.example.com/favicon.ico" };
const sender = { id: "ext", tab };
const keyCheck = (key) => (key === "cul_import9" ? { app: "RecipeHub", version: "0.16.0", name: "import", access: "recipe_push", canPushToInbox: false, canImport: true, aiCorrection: true } : { app: "RecipeHub", version: "0.16.0", name: "inbox", access: "inbox_push", canPushToInbox: true, canImport: false, aiCorrection: true });
const recipehub = (more = {}) =>
  vi.fn(async (url, init) => {
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    if (path === "/api/key-check") return answer(200, keyCheck(init.headers["x-api-key"]));
    const r = more[`${init.method} ${path}`];
    return r ? r(JSON.parse(init.body ?? "null")) : answer(404, { error: "no fake" });
  });

describe("what the floating button can do", () => {
  it("both keys: send, and import (with AI correction when it's ticked and RecipeHub can)", async () => {
    const { chrome } = fakeChrome({ stored: { ...stored, improve: true } });
    expect(await handle({ type: "bubble-state" }, { chrome, fetch: recipehub(), sender })).toEqual({ ok: true, canPush: true, canImport: true, improve: true, always: false });
  });

  it("AI correction ticked, but RecipeHub can't: a plain import", async () => {
    const fetch = vi.fn(async (url, init) => answer(200, { ...keyCheck(init.headers["x-api-key"]), aiCorrection: false }));
    const { chrome } = fakeChrome({ stored: { ...stored, improve: true } });
    expect(await handle({ type: "bubble-state" }, { chrome, fetch, sender })).toMatchObject({ canImport: true, improve: false });
  });

  it("only the inbox key: send only", async () => {
    const { chrome } = fakeChrome({ stored: { ...stored, importKey: "" } });
    expect(await handle({ type: "bubble-state" }, { chrome, fetch: recipehub(), sender })).toEqual({ ok: true, canPush: true, canImport: false, improve: false, always: false });
  });

  it("knows when it's on a site where it always shows; Stop showing takes the site out", async () => {
    const { chrome, store, registered } = fakeChrome({ stored: { ...stored, alwaysSites: ["https://www.example.com"] } });
    await chrome.scripting.registerContentScripts([{ id: "always-show", matches: ["https://www.example.com/*"], js: ["src/content/content_script.js"] }]);
    expect(await handle({ type: "bubble-state" }, { chrome, fetch: recipehub(), sender })).toMatchObject({ always: true });
    expect(await handle({ type: "always-off" }, { chrome, fetch: recipehub(), sender })).toEqual({ ok: true });
    expect(store.alwaysSites).toEqual([]);
    expect(registered.size).toBe(0);
  });

  it("not set up: says so", async () => {
    const { chrome } = fakeChrome({});
    expect(await handle({ type: "bubble-state" }, { chrome, fetch: vi.fn(), sender })).toMatchObject({ ok: false, problem: expect.stringMatching(/Add your RecipeHub address/) });
  });
});

// From the popup (it names the tab) or the floating button (the tab it's on): the worker reads the
// page, does it, and says how it went in a banner at the top of the page
describe("Send to Inbox and Import, on a page", () => {
  it("Send to Inbox: reads the tab and sends it (with its recipe); the banner says so", async () => {
    const fetch = recipehub({ "POST /api/inbox": () => answer(201, { id: 3 }) });
    const { chrome, onPage } = fakeChrome({ stored, page: { recipe: '{"@type":"Recipe","name":"Pork Roast"}' } });
    expect(await handle({ type: "act", action: "push" }, { chrome, fetch, sender })).toEqual({ ok: true, message: "Sent to your RecipeHub inbox", id: 3 });
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 7 }, func: readPage });
    expect(JSON.parse(fetch.mock.calls.at(-1)[1].body)).toMatchObject({ type: "RAW_RECIPE_DATA", url: tab.url, title: tab.title });
    expect(onPage.banners).toEqual([["Sending to RecipeHub…", "busy", null], ["Sent to your RecipeHub inbox", "ok", null]]);
  });

  it("Import goes straight into RecipeHub, leaving a note in the inbox's Imported list", async () => {
    const fetch = recipehub({ "POST /api/recipes/import": () => answer(200, { id: 12, status: "done", result: { recipeId: 31, title: "Pork Roast" } }) });
    const { chrome, onPage } = fakeChrome({ stored, page: { html: "<html>pork</html>" } });
    expect(await handle({ type: "act", action: "import" }, { chrome, fetch, sender })).toMatchObject({ ok: true, recipeUrl: "http://192.168.1.20:5173/#/recipes/31" });
    expect(JSON.parse(fetch.mock.calls.at(-1)[1].body)).toEqual({ url: tab.url, html: "<html>pork</html>", inbox: true, wait: 25 });
    expect(onPage.banners.at(-1)).toEqual(["Imported “Pork Roast” into RecipeHub", "ok", "http://192.168.1.20:5173/#/recipes/31"]);
  });

  it("with Run through AI correction ticked (and RecipeHub able to), it asks for it", async () => {
    const fetch = recipehub({ "POST /api/recipes/import": () => answer(200, { id: 12, status: "done", result: { recipeId: 31, title: "Pork Roast", improving: 13 } }) });
    const { chrome, onPage } = fakeChrome({ stored: { ...stored, improve: true } });
    await handle({ type: "act", action: "import" }, { chrome, fetch, sender });
    expect(JSON.parse(fetch.mock.calls.at(-1)[1].body)).toMatchObject({ improve: true, inbox: true });
    expect(onPage.banners[0]).toEqual(["Importing into RecipeHub… then AI tidies it up", "busy", null]);
    expect(onPage.banners.at(-1)[0]).toMatch(/AI is tidying it up/);
  });

  it("from the popup: the tab it names", async () => {
    const fetch = recipehub({ "POST /api/inbox": () => answer(201, { id: 3 }) });
    const { chrome } = fakeChrome({ stored });
    // (the popup's own page is never the one acted on, even if the popup happens to be in a tab)
    await handle({ type: "act", action: "push", tab: { ...tab, id: 9, url: "https://example.org/stew", title: "Stew" } }, { chrome, fetch, sender: { id: "ext", tab: { id: 40, url: "chrome-extension://ext/src/popup/popup.html" } } });
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 9 }, func: readPage });
    expect(JSON.parse(fetch.mock.calls.at(-1)[1].body)).toMatchObject({ url: "https://example.org/stew" });
  });

  it("a problem shows in the banner too", async () => {
    const { chrome, onPage } = fakeChrome({ stored });
    const r = await handle({ type: "act", action: "push" }, { chrome, fetch: () => Promise.reject(new TypeError("Failed to fetch")), sender });
    expect(r.ok).toBe(false);
    expect(onPage.banners.at(-1)).toEqual([r.problem, "problem", null]);
  });

  it("the page can't be read any more (it moved on): the link still goes", async () => {
    const fetch = recipehub({ "POST /api/inbox": () => answer(201, { id: 4 }) });
    const { chrome } = fakeChrome({ stored, page: new Error("Cannot access contents of the page") });
    expect(await handle({ type: "act", action: "push" }, { chrome, fetch, sender })).toMatchObject({ ok: true });
    expect(JSON.parse(fetch.mock.calls.at(-1)[1].body)).toMatchObject({ type: "RECIPE_LINK", url: tab.url });
  });

  it("no tab: nothing to do", async () => {
    const { chrome } = fakeChrome({ stored });
    expect(await handle({ type: "act", action: "push" }, { chrome, fetch: vi.fn(), sender: { id: "ext" } })).toEqual({ ok: false, problem: "Unknown request" });
  });
});
