import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { answer, fakeChrome, until } from "./fakeChrome.js";
import { init } from "../src/options/options.js";

// The options page: Culury's address and the API key, saved only once the test passes
const html = fs.readFileSync("src/options/options.html", "utf8");
const $ = (sel) => document.querySelector(sel);
const connected = { app: "Culury", version: "0.16.0", name: "Culury Companion", access: "inbox_push", canPushToInbox: true, canImport: false };
const submit = () => $("form").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));

beforeEach(() => {
  document.documentElement.innerHTML = html.replace(/^[\s\S]*?<html[^>]*>/i, "").replace(/<\/html>\s*$/i, "");
});

describe("the options page", () => {
  it("asks to reach that address, tests the key, and saves when it works", async () => {
    const fetch = vi.fn(() => answer(200, connected));
    const { chrome, store } = fakeChrome({ fetch });
    await init();
    $("#address").value = "192.168.86.222:5173/";
    $("#key").value = " cul_abc123 ";
    submit();
    await until(() => expect($("#result").textContent).toMatch(/Connected to Culury 0\.16\.0 as “Culury Companion” \(Inbox only\)/));
    expect(chrome.permissions.request).toHaveBeenCalledWith({ origins: ["http://192.168.86.222:5173/*"] });
    expect(fetch).toHaveBeenCalledWith("http://192.168.86.222:5173/api/key-check", expect.anything());
    expect(store).toEqual({ address: "http://192.168.86.222:5173", key: "cul_abc123" });
    expect($("#address").value).toBe("http://192.168.86.222:5173");
  });

  it("while testing, says so without looking done", async () => {
    fakeChrome({ fetch: vi.fn(() => new Promise(() => {})) });
    await init();
    $("#address").value = "https://culury.example.com";
    $("#key").value = "cul_abc";
    submit();
    await until(() => expect($("#result").textContent).toBe("Testing…"));
    expect($("#result").dataset.state).toBe("busy");
  });

  it("shows what's saved", async () => {
    fakeChrome({ stored: { address: "https://culury.example.com", key: "cul_saved" }, fetch: vi.fn(() => answer(200, connected)) });
    await init();
    expect($("#address").value).toBe("https://culury.example.com");
    expect($("#key").value).toBe("cul_saved");
  });

  it("a test that fails: says why and saves nothing", async () => {
    const { store } = fakeChrome({ stored: { address: "https://old.example.com", key: "cul_old" }, fetch: vi.fn(() => answer(401, { error: "Not logged in" })) });
    await init();
    $("#address").value = "https://culury.example.com";
    $("#key").value = "cul_wrong";
    submit();
    await until(() => expect($("#result").textContent).toMatch(/didn't recognize this API key/));
    expect(store).toEqual({ address: "https://old.example.com", key: "cul_old" });
  });

  it("refusing access to the address: says it's needed", async () => {
    const fetch = vi.fn();
    fakeChrome({ allow: false, fetch });
    await init();
    $("#address").value = "https://culury.example.com";
    $("#key").value = "cul_abc";
    submit();
    await until(() => expect($("#result").textContent).toMatch(/Allow the extension to reach https:\/\/culury\.example\.com/));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a bad address or no key: says so before trying", async () => {
    fakeChrome({ fetch: vi.fn() });
    await init();
    $("#address").value = "ftp://x.example.com";
    $("#key").value = "cul_abc";
    submit();
    await until(() => expect($("#result").textContent).toMatch(/http:\/\/ or https:\/\//));
    $("#address").value = "https://culury.example.com";
    $("#key").value = "";
    submit();
    await until(() => expect($("#result").textContent).toBe("Paste your API key"));
  });
});
