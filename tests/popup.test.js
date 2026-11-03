import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { answer, fakeChrome, until } from "./fakeChrome.js";
import { init } from "../src/popup/popup.js";

// The toolbar popup: is it connected, and send this page or a quick note to the inbox
const html = fs.readFileSync("src/popup/popup.html", "utf8");
const stored = { address: "http://192.168.86.222:5173", key: "cul_abc123" };
const connected = { app: "Culury", version: "0.16.0", name: "Culury Companion", access: "inbox_push", canPushToInbox: true, canImport: false };
const $ = (sel) => document.querySelector(sel);
const byText = (text) => [...document.querySelectorAll("button, a")].find((b) => b.textContent.trim() === text);

beforeEach(() => {
  document.documentElement.innerHTML = html.replace(/^[\s\S]*?<html[^>]*>/i, "").replace(/<\/html>\s*$/i, "");
});

function server(routes) {
  return vi.fn(async (url, init) => {
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const key = `${init?.method ?? "GET"} ${path}`;
    return routes[key] ? routes[key](init?.body ? JSON.parse(init.body) : undefined) : answer(404, { error: "no fake" });
  });
}

describe("the popup", () => {
  it("connected: says so, shows the page, and sends it to the inbox", async () => {
    const fetch = server({ "GET /api/key-check": () => answer(200, connected), "POST /api/inbox": () => answer(201, { id: 3, status: "PENDING" }) });
    fakeChrome({ stored, fetch });
    await init();
    await until(() => expect($("#status").textContent).toMatch(/Connected.*Culury Companion.*Inbox only/));
    expect($("#page-title").textContent).toBe("Pork Roast | Example");
    expect($("#page-site").textContent).toBe("example.com");
    byText("Send to Inbox").click();
    await until(() => expect($("#result").textContent).toBe("Sent to your Culury inbox"));
    const sent = JSON.parse(fetch.mock.calls.find(([, i]) => i?.method === "POST")[1].body);
    expect(sent).toMatchObject({ type: "RECIPE_LINK", url: "https://www.example.com/pork-roast", title: "Pork Roast | Example", sourceApp: "Culury Companion" });
  });

  it("a page with its recipe in it sends the recipe along", async () => {
    const fetch = server({ "GET /api/key-check": () => answer(200, connected), "POST /api/inbox": () => answer(201, { id: 3 }) });
    fakeChrome({ stored, fetch, page: { recipe: '{"@type":"Recipe","name":"Pork Roast"}' } });
    await init();
    await until(() => expect(byText("Send to Inbox").disabled).toBe(false));
    expect($("#page-kind").textContent).toBe("Recipe found on this page");
    byText("Send to Inbox").click();
    await until(() => expect($("#result").textContent).toBe("Sent to your Culury inbox"));
    expect(JSON.parse(fetch.mock.calls.find(([, i]) => i?.method === "POST")[1].body)).toMatchObject({ type: "RAW_RECIPE_DATA", content: '{"@type":"Recipe","name":"Pork Roast"}' });
  });

  it("a quick note starts with the text you'd highlighted, and goes with the page's link", async () => {
    const fetch = server({ "GET /api/key-check": () => answer(200, connected), "POST /api/inbox": () => answer(201, { id: 4 }) });
    fakeChrome({ stored, fetch, page: { selection: "Brine overnight" } });
    await init();
    await until(() => expect($("#note").value).toBe("Brine overnight"));
    $("#note").value = "Brine overnight, then roast low";
    byText("Send note").click();
    await until(() => expect($("#result").textContent).toBe("Sent to your Culury inbox"));
    expect(JSON.parse(fetch.mock.calls.find(([, i]) => i?.method === "POST")[1].body)).toMatchObject({ type: "TEXT_NOTE", content: "Brine overnight, then roast low", url: "https://www.example.com/pork-roast" });
    expect($("#note").value).toBe("");
  });

  it("while sending, says so without looking done", async () => {
    const fetch = server({ "GET /api/key-check": () => answer(200, connected), "POST /api/inbox": () => new Promise(() => {}) });
    fakeChrome({ stored, fetch });
    await init();
    await until(() => expect(byText("Send to Inbox").disabled).toBe(false));
    byText("Send to Inbox").click();
    await until(() => expect($("#result").textContent).toBe("Sending…"));
    expect($("#result").dataset.state).toBe("busy");
    expect(byText("Send to Inbox").disabled).toBe(true);
  });

  it("an empty note isn't sent", async () => {
    const fetch = server({ "GET /api/key-check": () => answer(200, connected) });
    fakeChrome({ stored, fetch });
    await init();
    await until(() => expect(byText("Send note").disabled).toBe(false));
    byText("Send note").click();
    await until(() => expect($("#result").textContent).toBe("Write a note first"));
    expect(fetch.mock.calls.some(([, i]) => i?.method === "POST")).toBe(false);
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
    const fetch = server({ "GET /api/key-check": () => answer(200, { ...connected, access: "recipe_push", canPushToInbox: false, canImport: true }) });
    fakeChrome({ stored, fetch });
    await init();
    await until(() => expect($("#status").textContent).toMatch(/can't send to the inbox.*Inbox only/));
    expect(byText("Send to Inbox").disabled).toBe(true);
  });

  it("a browser page (chrome://): only notes, without a link", async () => {
    const fetch = server({ "GET /api/key-check": () => answer(200, connected) });
    fakeChrome({ stored, fetch, tab: { id: 2, url: "chrome://newtab/", title: "New Tab" }, page: new Error("Cannot access a chrome:// URL") });
    await init();
    await until(() => expect($("#page-kind").textContent).toMatch(/isn't a web page/));
    expect(byText("Send to Inbox").disabled).toBe(true);
    expect(byText("Send note").disabled).toBe(false);
  });

  it("Open inbox opens Culury's inbox in a new tab", async () => {
    const fetch = server({ "GET /api/key-check": () => answer(200, connected) });
    const { opened } = fakeChrome({ stored, fetch });
    await init();
    byText("Open inbox").click();
    await until(() => expect(opened).toEqual(["http://192.168.86.222:5173/#/inbox"]));
  });

  it("can't reach Culury: says so", async () => {
    fakeChrome({ stored, fetch: vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))) });
    await init();
    await until(() => expect($("#status").textContent).toMatch(/Can't reach Culury at http:\/\/192\.168\.86\.222:5173/));
  });

  describe("Import to Culury", () => {
    const both = { ...stored, importKey: "cul_import9" };
    const importer = { app: "Culury", version: "0.16.0", name: "Culury Companion import", access: "recipe_push", canPushToInbox: false, canImport: true, aiCorrection: true };
    const routesFor = (check, more = {}) =>
      vi.fn(async (url, init) => {
        const path = url.replace(/^https?:\/\/[^/]+/, "");
        if (path === "/api/key-check") return answer(200, init.headers["x-api-key"] === "cul_import9" ? check : connected);
        const key = `${init?.method ?? "GET"} ${path}`;
        return more[key] ? more[key](JSON.parse(init.body ?? "null")) : answer(404, { error: "no fake" });
      });

    it("imports the page as you see it, and links to the recipe", async () => {
      const fetch = routesFor(importer, { "POST /api/recipes/import": () => answer(200, { id: 12, status: "done", result: { recipeId: 31, title: "Pork Roast" } }) });
      fakeChrome({ stored: both, fetch, page: { html: "<html>pork</html>" } });
      await init();
      await until(() => expect(byText("Import to Culury").disabled).toBe(false));
      expect($("#improve").checked).toBe(false);
      byText("Import to Culury").click();
      await until(() => expect($("#result").textContent).toBe("Imported “Pork Roast”"));
      expect($("#open-recipe").href).toBe("http://192.168.86.222:5173/#/recipes/31");
      expect($("#open-recipe").hidden).toBe(false);
      const sent = JSON.parse(fetch.mock.calls.find(([u]) => u.endsWith("/api/recipes/import"))[1].body);
      expect(sent).toEqual({ url: "https://www.example.com/pork-roast", html: "<html>pork</html>", wait: 25 });
    });

    it("Run through AI correction: asks for it, and remembers the choice", async () => {
      const fetch = routesFor(importer, { "POST /api/recipes/import": () => answer(200, { id: 12, status: "done", result: { recipeId: 31, title: "Pork Roast", improving: 13 } }) });
      const { store } = fakeChrome({ stored: both, fetch });
      await init();
      await until(() => expect($("#improve").disabled).toBe(false));
      $("#improve").click();
      expect(store.improve).toBe(true);
      byText("Import to Culury").click();
      await until(() => expect($("#result").textContent).toMatch(/AI is tidying it up/));
      expect(JSON.parse(fetch.mock.calls.find(([u]) => u.endsWith("/api/recipes/import"))[1].body)).toMatchObject({ improve: true });
    });

    it("the choice is ticked next time", async () => {
      fakeChrome({ stored: { ...both, improve: true }, fetch: routesFor(importer) });
      await init();
      await until(() => expect($("#improve").checked).toBe(true));
    });

    it("AI not set up in Culury: AI correction can't be ticked, and says why", async () => {
      fakeChrome({ stored: { ...both, improve: true }, fetch: routesFor({ ...importer, aiCorrection: false }) });
      await init();
      await until(() => expect(byText("Import to Culury").disabled).toBe(false));
      expect($("#improve").disabled).toBe(true);
      expect($("#improve").checked).toBe(false);
      expect($("#import-hint").textContent).toMatch(/AI correction needs AI in Culury/);
    });

    it("no import key: says where to add one", async () => {
      fakeChrome({ stored, fetch: routesFor(importer) });
      await init();
      await until(() => expect($("#import-hint").textContent).toMatch(/Add a Recipe push key in Settings/));
      expect(byText("Import to Culury").disabled).toBe(true);
    });

    it("an import key that can't import: says so", async () => {
      fakeChrome({ stored: both, fetch: routesFor({ ...importer, access: "read", canImport: false }) });
      await init();
      await until(() => expect($("#import-hint").textContent).toMatch(/can't import.*Recipe push/));
      expect(byText("Import to Culury").disabled).toBe(true);
    });

    it("Instagram goes by its link (Culury reads the post itself)", async () => {
      const fetch = routesFor(importer, { "POST /api/recipes/import": () => answer(200, { id: 12, status: "done", result: { recipeId: 32, title: "Smashed potatoes" } }) });
      fakeChrome({ stored: both, fetch, tab: { id: 3, url: "https://www.instagram.com/reel/abc/", title: "Instagram" }, page: { html: "<html>insta</html>" } });
      await init();
      await until(() => expect(byText("Import to Culury").disabled).toBe(false));
      byText("Import to Culury").click();
      await until(() => expect($("#result").textContent).toBe("Imported “Smashed potatoes”"));
      expect(JSON.parse(fetch.mock.calls.find(([u]) => u.endsWith("/api/recipes/import"))[1].body)).toEqual({ url: "https://www.instagram.com/reel/abc/", wait: 25 });
    });
  });
});
