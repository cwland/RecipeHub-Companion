import { describe, expect, it, vi } from "vitest";
import { checkConnection, importPage, linkItem, noteItem, normalizeAddress, push } from "../src/lib/culury.js";

const answer = (status, json) => Promise.resolve(new Response(json === undefined ? null : JSON.stringify(json), { status, headers: { "content-type": "application/json" } }));
const settings = { address: "http://192.168.86.222:5173", key: "cul_abc123" };

describe("the Culury address", () => {
  it("is tidied to its origin", () => {
    expect(normalizeAddress(" http://192.168.86.222:5173/ ")).toBe("http://192.168.86.222:5173");
    expect(normalizeAddress("https://culury.example.com/#/recipes")).toBe("https://culury.example.com");
    expect(normalizeAddress("culury.example.com")).toBe("https://culury.example.com");
    expect(normalizeAddress("localhost:5173")).toBe("http://localhost:5173");
  });

  it("must be a web address", () => {
    expect(() => normalizeAddress("")).toThrow("Enter your Culury address");
    expect(() => normalizeAddress("ftp://x.example.com")).toThrow("http:// or https://");
    expect(() => normalizeAddress("not a host")).toThrow();
  });
});

describe("what's sent for the page you're on", () => {
  const tab = { url: "https://www.example.com/pork-roast?utm_source=x", title: "Pork Roast | Example", favIconUrl: "https://www.example.com/favicon.ico" };

  it("a recipe page: a link, with its title and icon", () => {
    expect(linkItem(tab, {}, "2026-11-03T10:00:00.000Z")).toEqual({
      type: "RECIPE_LINK",
      url: tab.url,
      title: "Pork Roast | Example",
      sourceApp: "Culury Companion",
      metadata: { pageTitle: "Pork Roast | Example", favIconUrl: tab.favIconUrl, capturedAt: "2026-11-03T10:00:00.000Z" },
    });
  });

  it("a page carrying its recipe (JSON-LD): the recipe goes too, so Culury can read it even if the site blocks it later", () => {
    const recipe = '{"@type":"Recipe","name":"Pork Roast"}';
    expect(linkItem(tab, { recipe })).toMatchObject({ type: "RAW_RECIPE_DATA", url: tab.url, content: recipe });
  });

  it("Instagram: an Instagram link", () => {
    expect(linkItem({ ...tab, url: "https://www.instagram.com/reel/abc/" }, {}).type).toBe("INSTAGRAM_LINK");
  });

  it("leaves out an icon that isn't a web address (chrome://, data:)", () => {
    expect(linkItem({ ...tab, favIconUrl: "data:image/png;base64,AAA" }, {}).metadata.favIconUrl).toBeUndefined();
  });

  it("a note: the text, with the page it was written on", () => {
    expect(noteItem("  Dry brine overnight  ", tab, "2026-11-03T10:00:00.000Z")).toEqual({
      type: "TEXT_NOTE",
      content: "Dry brine overnight",
      url: tab.url,
      sourceApp: "Culury Companion",
      metadata: { pageTitle: "Pork Roast | Example", favIconUrl: tab.favIconUrl, capturedAt: "2026-11-03T10:00:00.000Z" },
    });
    expect(noteItem("A thought", { url: "chrome://newtab/", title: "New Tab" }).url).toBeUndefined();
  });
});

describe("talking to Culury", () => {
  it("checking the connection sends the key and says what it may do", async () => {
    const fetch = vi.fn(() => answer(200, { app: "Culury", version: "0.16.0", name: "Culury Companion", access: "inbox_push", canPushToInbox: true, canImport: false }));
    expect(await checkConnection(settings, fetch)).toEqual({ ok: true, name: "Culury Companion", access: "inbox_push", canPushToInbox: true, canImport: false, aiCorrection: false, version: "0.16.0" });
    expect(fetch).toHaveBeenCalledWith("http://192.168.86.222:5173/api/key-check", expect.objectContaining({ headers: expect.objectContaining({ "x-api-key": "cul_abc123" }) }));
  });

  it("says what's wrong in plain words", async () => {
    expect(await checkConnection(settings, () => answer(401, { error: "Not logged in" }))).toEqual({ ok: false, problem: "Culury didn't recognize this API key. Check it in Settings › API keys." });
    expect(await checkConnection(settings, () => answer(403, { error: "API keys are turned off in Settings" }))).toEqual({ ok: false, problem: "API keys are turned off in Settings" });
    expect(await checkConnection(settings, () => answer(200, { hello: "world" }))).toMatchObject({ ok: false, problem: expect.stringContaining("doesn't look like Culury") });
    expect(await checkConnection(settings, () => Promise.reject(new TypeError("Failed to fetch")))).toEqual({ ok: false, problem: "Can't reach Culury at http://192.168.86.222:5173. Is it running, and is the address right?" });
    expect(await checkConnection(settings, () => answer(404, { error: "Not found" }))).toMatchObject({ ok: false, problem: expect.stringContaining("update Culury") });
    expect(await checkConnection({ address: "", key: "" }, vi.fn())).toEqual({ ok: false, problem: "Add your Culury address and API key in the extension's settings." });
  });

  it("pushing to the inbox", async () => {
    const fetch = vi.fn(() => answer(201, { id: 5, status: "PENDING" }));
    const item = { type: "TEXT_NOTE", content: "Hi" };
    expect(await push(settings, item, fetch)).toEqual({ ok: true, message: "Sent to your Culury inbox", id: 5 });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("http://192.168.86.222:5173/api/inbox");
    expect(init).toMatchObject({ method: "POST", headers: { "content-type": "application/json", "x-api-key": "cul_abc123" } });
    expect(JSON.parse(init.body)).toEqual(item);
  });

  it("already waiting, or refused", async () => {
    expect(await push(settings, {}, () => answer(200, { id: 5, duplicate: true }))).toEqual({ ok: true, message: "Already in your Culury inbox", id: 5 });
    expect(await push(settings, {}, () => answer(403, { error: "This API key's access (Read only) doesn't allow this" }))).toEqual({ ok: false, problem: "This API key's access (Read only) doesn't allow this" });
    expect(await push(settings, {}, () => answer(400, { error: "Invalid request", details: [{ path: "url", message: "Only http:// and https:// addresses" }] }))).toEqual({ ok: false, problem: "Only http:// and https:// addresses" });
  });
});

describe("importing straight into Culury (the Recipe push key)", () => {
  const both = { ...settings, importKey: "cul_import9" };
  const page = { url: "https://www.example.com/pork-roast", html: "<html>…</html>" };
  const done = (result) => ({ id: 12, kind: "import-url", status: "done", result, error: null });
  const noWait = { sleep: () => Promise.resolve() };

  it("sends the page with the import key, and says what came in, with its link", async () => {
    const fetch = vi.fn(() => answer(200, done({ recipeId: 31, title: "Pork Roast" })));
    expect(await importPage(both, page, false, fetch, noWait)).toEqual({ ok: true, message: "Imported “Pork Roast” into Culury", recipeUrl: "http://192.168.86.222:5173/#/recipes/31" });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("http://192.168.86.222:5173/api/recipes/import");
    expect(init.headers["x-api-key"]).toBe("cul_import9");
    expect(JSON.parse(init.body)).toEqual({ url: page.url, html: page.html, wait: 25 });
  });

  it("with AI correction: asks for it, and says it's being tidied up", async () => {
    const fetch = vi.fn(() => answer(200, done({ recipeId: 31, title: "Pork Roast", improving: 13 })));
    expect(await importPage(both, page, true, fetch, noWait)).toMatchObject({ ok: true, message: "Imported “Pork Roast” into Culury. AI is tidying it up in the background." });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ improve: true });
  });

  it("still going after the wait: follows it until it's done", async () => {
    const answers = [answer(202, { id: 12, status: "running" }), answer(200, { id: 12, status: "running" }), answer(200, done({ recipeId: 31, title: "Pork Roast" }))];
    const fetch = vi.fn(() => answers.shift());
    expect(await importPage(both, page, false, fetch, noWait)).toMatchObject({ ok: true, recipeUrl: "http://192.168.86.222:5173/#/recipes/31" });
    expect(fetch.mock.calls.slice(1).map(([u]) => u)).toEqual(["http://192.168.86.222:5173/api/imports/12", "http://192.168.86.222:5173/api/imports/12"]);
  });

  it("already in your recipes, or it couldn't be read", async () => {
    expect(await importPage(both, page, false, () => answer(200, done({ duplicateOf: 8, title: "Pork Roast" })), noWait)).toEqual({ ok: true, message: "Already in your recipes", recipeUrl: "http://192.168.86.222:5173/#/recipes/8" });
    expect(await importPage(both, page, false, () => answer(200, { id: 12, status: "failed", error: "No recipe found on that page" }), noWait)).toEqual({ ok: false, problem: "No recipe found on that page" });
  });

  it("no import key: says where to add one", async () => {
    expect(await importPage(settings, page, false, vi.fn(), noWait)).toEqual({ ok: false, problem: "Add a Recipe push key in the extension's settings to import directly." });
  });

  it("taking very long: says it'll turn up in Culury", async () => {
    const fetch = vi.fn(() => answer(202, { id: 12, status: "running" }));
    expect(await importPage(both, page, false, fetch, { sleep: () => Promise.resolve(), tries: 3 })).toEqual({ ok: true, message: "Still importing: it'll be in your Culury recipes shortly." });
  });
});
