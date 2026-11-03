import { describe, expect, it, vi } from "vitest";
import { answer, fakeChrome } from "./fakeChrome.js";
import { handle } from "../src/background/handlers.js";
import { readPage } from "../src/lib/page.js";

// The bubble on the page asks the service worker; the worker reads the page and talks to Culury
const stored = { address: "http://192.168.86.222:5173", key: "cul_inbox", importKey: "cul_import9" };
const tab = { id: 7, url: "https://www.example.com/pork-roast", title: "Pork Roast | Example", favIconUrl: "https://www.example.com/favicon.ico" };
const sender = { id: "ext", tab };
const keyCheck = (key) => (key === "cul_import9" ? { app: "Culury", version: "0.16.0", name: "import", access: "recipe_push", canPushToInbox: false, canImport: true, aiCorrection: true } : { app: "Culury", version: "0.16.0", name: "inbox", access: "inbox_push", canPushToInbox: true, canImport: false, aiCorrection: true });
const culury = (more = {}) =>
  vi.fn(async (url, init) => {
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    if (path === "/api/key-check") return answer(200, keyCheck(init.headers["x-api-key"]));
    const r = more[`${init.method} ${path}`];
    return r ? r(JSON.parse(init.body ?? "null")) : answer(404, { error: "no fake" });
  });

describe("what the bubble can do", () => {
  it("both keys: push, import, and AI correction", async () => {
    const { chrome } = fakeChrome({ stored });
    expect(await handle({ type: "bubble-state" }, { chrome, fetch: culury(), sender })).toEqual({ ok: true, canPush: true, canImport: true, aiCorrection: true });
  });

  it("only the inbox key: push only", async () => {
    const { chrome } = fakeChrome({ stored: { ...stored, importKey: "" } });
    expect(await handle({ type: "bubble-state" }, { chrome, fetch: culury(), sender })).toEqual({ ok: true, canPush: true, canImport: false, aiCorrection: false });
  });

  it("not set up: says so", async () => {
    const { chrome } = fakeChrome({});
    expect(await handle({ type: "bubble-state" }, { chrome, fetch: vi.fn(), sender })).toMatchObject({ ok: false, problem: expect.stringMatching(/Add your Culury address/) });
  });
});

describe("the bubble's actions", () => {
  it("Push to Inbox: reads the tab it's on and sends it (with its recipe)", async () => {
    const fetch = culury({ "POST /api/inbox": () => answer(201, { id: 3 }) });
    const { chrome } = fakeChrome({ stored, page: { recipe: '{"@type":"Recipe","name":"Pork Roast"}' } });
    expect(await handle({ type: "bubble", action: "push" }, { chrome, fetch, sender })).toEqual({ ok: true, message: "Sent to your Culury inbox", id: 3 });
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 7 }, func: readPage });
    expect(JSON.parse(fetch.mock.calls.at(-1)[1].body)).toMatchObject({ type: "RAW_RECIPE_DATA", url: tab.url, title: tab.title });
  });

  it("Import now, and Import + AI clean-up", async () => {
    const fetch = culury({ "POST /api/recipes/import": (b) => answer(200, { id: 12, status: "done", result: { recipeId: 31, title: "Pork Roast", ...(b.improve ? { improving: 13 } : {}) } }) });
    const { chrome } = fakeChrome({ stored, page: { html: "<html>pork</html>" } });
    expect(await handle({ type: "bubble", action: "import" }, { chrome, fetch, sender })).toMatchObject({ ok: true, message: "Imported “Pork Roast”", recipeUrl: "http://192.168.86.222:5173/#/recipes/31" });
    expect(JSON.parse(fetch.mock.calls.at(-1)[1].body)).toEqual({ url: tab.url, html: "<html>pork</html>", wait: 25 });
    expect(await handle({ type: "bubble", action: "import-ai" }, { chrome, fetch, sender })).toMatchObject({ ok: true, message: expect.stringMatching(/AI is tidying it up/) });
    expect(JSON.parse(fetch.mock.calls.at(-1)[1].body)).toMatchObject({ improve: true });
  });

  it("the page can't be read any more (it moved on): the link still goes", async () => {
    const fetch = culury({ "POST /api/inbox": () => answer(201, { id: 4 }) });
    const { chrome } = fakeChrome({ stored, page: new Error("Cannot access contents of the page") });
    expect(await handle({ type: "bubble", action: "push" }, { chrome, fetch, sender })).toMatchObject({ ok: true });
    expect(JSON.parse(fetch.mock.calls.at(-1)[1].body)).toMatchObject({ type: "RECIPE_LINK", url: tab.url });
  });

  it("only from a page in a tab", async () => {
    const { chrome } = fakeChrome({ stored });
    expect(await handle({ type: "bubble", action: "push" }, { chrome, fetch: vi.fn(), sender: { id: "ext" } })).toEqual({ ok: false, problem: "Unknown request" });
  });
});
