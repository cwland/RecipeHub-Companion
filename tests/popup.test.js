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
});
