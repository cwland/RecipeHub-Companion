import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { answer, fakeChrome, until } from "./fakeChrome.js";
import { init } from "../src/popup/popup.js";

// The toolbar popup: is it connected; Send to Inbox or Import this page (the popup closes and a
// banner at the top of the page says how it went); the floating button switch
const html = fs.readFileSync("src/popup/popup.html", "utf8");
const stored = { address: "http://192.168.86.222:5173", key: "cul_abc123" };
const both = { ...stored, importKey: "cul_import9" };
const connected = { app: "Culury", version: "0.16.0", name: "Culury Companion", access: "inbox_push", canPushToInbox: true, canImport: false };
const importer = { app: "Culury", version: "0.16.0", name: "Culury Companion import", access: "recipe_push", canPushToInbox: false, canImport: true, aiCorrection: true };
const $ = (sel) => document.querySelector(sel);
const byText = (text) => [...document.querySelectorAll("button, a")].find((b) => b.textContent.trim() === text);

let closed;
beforeEach(() => {
  document.documentElement.innerHTML = html.replace(/^[\s\S]*?<html[^>]*>/i, "").replace(/<\/html>\s*$/i, "");
  closed = vi.spyOn(window, "close").mockImplementation(() => {});
});

// Culury, answering each key's check (and anything else given)
const culury = (importCheck = importer, more = {}) =>
  vi.fn(async (url, init) => {
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    if (path === "/api/key-check") return answer(200, init.headers["x-api-key"] === "cul_import9" ? importCheck : connected);
    const r = more[`${init?.method ?? "GET"} ${path}`];
    return r ? r(JSON.parse(init.body ?? "null")) : answer(404, { error: "no fake" });
  });

describe("the popup", () => {
  it("connected: says so, and shows the page", async () => {
    fakeChrome({ stored, fetch: culury() });
    await init();
    await until(() => expect($("#status").textContent).toMatch(/Connected.*Culury Companion.*Inbox only/));
    expect($("#page-title").textContent).toBe("Pork Roast | Example");
    expect($("#page-site").textContent).toBe("example.com");
  });

  it("no quick notes any more", async () => {
    fakeChrome({ stored, fetch: culury() });
    await init();
    expect($("#note")).toBeNull();
    expect(byText("Send note")).toBeUndefined();
  });

  it("Send to Inbox: the popup closes, and the page's banner says it was added", async () => {
    const fetch = culury(importer, { "POST /api/inbox": () => answer(201, { id: 3 }) });
    const { onPage } = fakeChrome({ stored, fetch, page: { recipe: '{"@type":"Recipe","name":"Pork Roast"}' } });
    await init();
    await until(() => expect(byText("Send to Inbox").disabled).toBe(false));
    expect($("#page-kind").textContent).toBe("Recipe found on this page");
    byText("Send to Inbox").click();
    expect(closed).toHaveBeenCalled();
    await until(() => expect(onPage.banners.at(-1)).toEqual(["Sent to your Culury inbox", "ok", null]));
    expect(JSON.parse(fetch.mock.calls.find(([, i]) => i?.method === "POST")[1].body)).toMatchObject({ type: "RAW_RECIPE_DATA", url: "https://www.example.com/pork-roast" });
  });

  it("Import to Culury: straight in (noted in the inbox's Imported list); the popup closes", async () => {
    const fetch = culury(importer, { "POST /api/recipes/import": () => answer(200, { id: 12, status: "done", result: { recipeId: 31, title: "Pork Roast" } }) });
    const { onPage } = fakeChrome({ stored: both, fetch, page: { html: "<html>pork</html>" } });
    await init();
    await until(() => expect(byText("Import to Culury").disabled).toBe(false));
    byText("Import to Culury").click();
    expect(closed).toHaveBeenCalled();
    await until(() => expect(onPage.banners.at(-1)).toEqual(["Imported “Pork Roast” into Culury", "ok", "http://192.168.86.222:5173/#/recipes/31"]));
    expect(JSON.parse(fetch.mock.calls.find(([u]) => u.endsWith("/api/recipes/import"))[1].body)).toEqual({ url: "https://www.example.com/pork-roast", html: "<html>pork</html>", inbox: true, wait: 25 });
  });

  it("Run through AI correction: remembered, and the import asks for it", async () => {
    const fetch = culury(importer, { "POST /api/recipes/import": () => answer(200, { id: 12, status: "done", result: { recipeId: 31, title: "Pork Roast", improving: 13 } }) });
    const { store } = fakeChrome({ stored: both, fetch });
    await init();
    await until(() => expect($("#improve").disabled).toBe(false));
    $("#improve").click();
    expect(store.improve).toBe(true);
    byText("Import to Culury").click();
    await until(() => expect(fetch.mock.calls.some(([u]) => u.endsWith("/api/recipes/import"))).toBe(true));
    expect(JSON.parse(fetch.mock.calls.find(([u]) => u.endsWith("/api/recipes/import"))[1].body)).toMatchObject({ improve: true });
  });

  it("the choice is ticked next time", async () => {
    fakeChrome({ stored: { ...both, improve: true }, fetch: culury() });
    await init();
    await until(() => expect($("#improve").checked).toBe(true));
  });

  it("AI not set up in Culury: AI correction can't be ticked, and says why", async () => {
    fakeChrome({ stored: { ...both, improve: true }, fetch: culury({ ...importer, aiCorrection: false }) });
    await init();
    await until(() => expect(byText("Import to Culury").disabled).toBe(false));
    expect($("#improve").disabled).toBe(true);
    expect($("#improve").checked).toBe(false);
    expect($("#import-hint").textContent).toMatch(/AI correction needs AI in Culury/);
  });

  it("no import key: says where to add one", async () => {
    fakeChrome({ stored, fetch: culury() });
    await init();
    await until(() => expect($("#import-hint").textContent).toMatch(/Add a Recipe push key in Settings/));
    expect(byText("Import to Culury").disabled).toBe(true);
  });

  it("an import key that can't import: says so", async () => {
    fakeChrome({ stored: both, fetch: culury({ ...importer, access: "read", canImport: false }) });
    await init();
    await until(() => expect($("#import-hint").textContent).toMatch(/can't import.*Recipe push/));
    expect(byText("Import to Culury").disabled).toBe(true);
  });

  it("not set up yet: says so, can't send, and Settings opens the options", async () => {
    const { chrome } = fakeChrome({ fetch: vi.fn() });
    await init();
    await until(() => expect($("#status").textContent).toMatch(/Add your Culury address and API key/));
    expect(byText("Send to Inbox").disabled).toBe(true);
    byText("Settings").click();
    expect(chrome.runtime.openOptionsPage).toHaveBeenCalled();
  });

  it("a key that can't push to the inbox: says which kind to use", async () => {
    fakeChrome({ stored, fetch: vi.fn(async () => answer(200, { ...connected, access: "recipe_push", canPushToInbox: false, canImport: true })) });
    await init();
    await until(() => expect($("#status").textContent).toMatch(/can't send to the inbox.*Inbox only/));
    expect(byText("Send to Inbox").disabled).toBe(true);
  });

  it("a browser page (chrome://): nothing to send", async () => {
    fakeChrome({ stored, fetch: culury(), tab: { id: 2, url: "chrome://newtab/", title: "New Tab" }, page: new Error("Cannot access a chrome:// URL") });
    await init();
    await until(() => expect($("#page-kind").textContent).toMatch(/isn't a web page/));
    expect(byText("Send to Inbox").disabled).toBe(true);
    expect($("#bubble").disabled).toBe(true);
  });

  it("Open inbox opens Culury's inbox in a new tab", async () => {
    const { opened } = fakeChrome({ stored, fetch: culury() });
    await init();
    byText("Open inbox").click();
    await until(() => expect(opened).toEqual(["http://192.168.86.222:5173/#/inbox"]));
  });

  it("can't reach Culury: says so", async () => {
    fakeChrome({ stored, fetch: vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))) });
    await init();
    await until(() => expect($("#status").textContent).toMatch(/Can't reach Culury at http:\/\/192\.168\.86\.222:5173/));
  });

  describe("the floating button switch", () => {
    it("puts the bubble on this page, and takes it off", async () => {
      const { chrome, onPage } = fakeChrome({ stored, fetch: culury() });
      await init();
      await until(() => expect($("#bubble").disabled).toBe(false));
      expect($("#bubble").checked).toBe(false);
      $("#bubble").click();
      await until(() => expect(onPage.bubble).toBe(true));
      expect(chrome.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 7 }, files: ["src/content/content_script.js"] });
      $("#bubble").click();
      await until(() => expect(onPage.bubble).toBe(false));
    });

    it("on when the bubble is already on the page", async () => {
      fakeChrome({ stored, fetch: culury(), bubble: true });
      await init();
      await until(() => expect($("#bubble").checked).toBe(true));
    });
  });

  describe("Always show on this site", () => {
    it("asks the browser for this site, adds it, and puts the button on now", async () => {
      const { chrome, onPage, registered, store } = fakeChrome({ stored, fetch: culury() });
      await init();
      await until(() => expect($("#always").disabled).toBe(false));
      expect($("#always-site").textContent).toBe("example.com");
      $("#always").click();
      await until(() => expect(store.alwaysSites).toEqual(["https://www.example.com"]));
      expect(chrome.permissions.request).toHaveBeenCalledWith({ origins: ["https://www.example.com/*"] });
      expect(registered.get("always-show").matches).toEqual(["https://www.example.com/*"]);
      await until(() => expect(onPage.bubble).toBe(true));
      expect($("#bubble").checked).toBe(true);
    });

    it("on for a site already in the list; off takes it out", async () => {
      const { store } = fakeChrome({ stored: { ...stored, alwaysSites: ["https://www.example.com"] }, fetch: culury() });
      await init();
      await until(() => expect($("#always").checked).toBe(true));
      $("#always").click();
      await until(() => expect(store.alwaysSites).toEqual([]));
    });

    it("the browser says no: stays off, and says why", async () => {
      fakeChrome({ stored, fetch: culury(), allow: false });
      await init();
      await until(() => expect($("#always").disabled).toBe(false));
      $("#always").click();
      await until(() => expect($("#result").textContent).toMatch(/needs your OK to read example\.com/));
      expect($("#always").checked).toBe(false);
    });

    it("not on browser pages", async () => {
      fakeChrome({ stored, fetch: culury(), tab: { id: 2, url: "chrome://newtab/", title: "New Tab" }, page: new Error("Cannot access a chrome:// URL") });
      await init();
      await until(() => expect($("#page-kind").textContent).toMatch(/isn't a web page/));
      expect($("#always").disabled).toBe(true);
    });
  });
});
