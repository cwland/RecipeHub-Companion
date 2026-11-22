import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { until } from "./fakeChrome.js";

// The floating bubble, put on a page by the popup's switch (src/content/content_script.js runs in
// the page as a plain script). It asks the service worker for everything.
const code = fs.readFileSync("src/content/content_script.js", "utf8");
const inject = () => new Function(code)();
const host = () => document.getElementById("recipehub-companion-bubble");
const root = () => host().shadowRoot;
const item = (name) => [...root().querySelectorAll("[role=menuitem]")].find((b) => b.textContent.includes(name));

function worker(state = { ok: true, canPush: true, canImport: true, improve: false }, results = {}) {
  const sendMessage = vi.fn(async (msg) => (msg.type === "bubble-state" ? state : (results[msg.action] ?? { ok: true, message: "Sent to your RecipeHub inbox" })));
  globalThis.chrome = { runtime: { sendMessage } };
  return sendMessage;
}
const pointer = (el, type, x, y) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }));
const click = (el) => {
  pointer(el, "pointerdown", 10, 10);
  pointer(el, "pointerup", 10, 10);
  el.click();
};

beforeEach(() => {
  document.querySelectorAll("#recipehub-companion-bubble").forEach((b) => b.remove()); // it sits outside <body>
  document.body.innerHTML = "<h1>Pork Roast</h1>";
  delete window.__recipehubCompanion;
});

describe("the floating bubble", () => {
  it("appears once, however many times it's switched on", async () => {
    worker();
    inject();
    inject();
    expect(document.querySelectorAll("#recipehub-companion-bubble")).toHaveLength(1);
    expect(root().querySelector("button[aria-label='RecipeHub Companion']")).toBeTruthy();
    expect(window.__recipehubCompanion.present()).toBe(true);
  });

  it("its menu: Send to Inbox, Import, Hide", async () => {
    worker();
    inject();
    click(root().querySelector("button[aria-label='RecipeHub Companion']"));
    await until(() => expect(root().querySelector("[role=menu]").hidden).toBe(false));
    await until(() => expect([...root().querySelectorAll("[role=menuitem]")].map((b) => b.textContent.trim())).toEqual(["📬 Send to Inbox", "⚡ Import", "Hide"]));
  });

  it("Import says when it'll run through AI correction (as ticked in the popup)", async () => {
    worker({ ok: true, canPush: true, canImport: true, improve: true });
    inject();
    click(root().querySelector("button[aria-label='RecipeHub Companion']"));
    await until(() => expect(item("Import").textContent.trim()).toBe("⚡ Import with AI correction"));
  });

  it("Send to Inbox and Import ask the worker (the banner at the top of the page says how it went) and close the menu", async () => {
    const send = worker();
    inject();
    click(root().querySelector("button[aria-label='RecipeHub Companion']"));
    await until(() => expect(item("Send to Inbox").disabled).toBe(false));
    item("Send to Inbox").click();
    expect(send).toHaveBeenCalledWith({ type: "act", action: "push" });
    expect(root().querySelector("[role=menu]").hidden).toBe(true);
    click(root().querySelector("button[aria-label='RecipeHub Companion']"));
    await until(() => expect(item("Import").disabled).toBe(false));
    item("Import").click();
    expect(send).toHaveBeenCalledWith({ type: "act", action: "import" });
  });

  it("no import key: only Send to Inbox", async () => {
    worker({ ok: true, canPush: true, canImport: false, improve: false });
    inject();
    click(root().querySelector("button[aria-label='RecipeHub Companion']"));
    await until(() => expect(item("Send to Inbox").disabled).toBe(false));
    expect(item("Import")).toBeUndefined();
  });

  it("on a site where it always shows: Stop showing on this site", async () => {
    const send = worker({ ok: true, canPush: true, canImport: false, improve: false, always: true });
    inject();
    click(root().querySelector("button[aria-label='RecipeHub Companion']"));
    await until(() => expect(item("Stop showing on this site")).toBeTruthy());
    item("Stop showing on this site").click();
    await until(() => expect(send).toHaveBeenCalledWith({ type: "always-off" }));
    await until(() => expect(host()).toBeNull());
  });

  it("not on such a site: no Stop showing", async () => {
    worker();
    inject();
    click(root().querySelector("button[aria-label='RecipeHub Companion']"));
    await until(() => expect(item("Hide")).toBeTruthy());
    expect(item("Stop showing")).toBeUndefined();
  });

  it("not set up: the menu says so", async () => {
    worker({ ok: false, problem: "Add your RecipeHub address and API key in the extension's settings." });
    inject();
    click(root().querySelector("button[aria-label='RecipeHub Companion']"));
    await until(() => expect(root().querySelector("[role=menu]").textContent).toMatch(/Add your RecipeHub address/));
  });

  it("Hide takes it off the page", async () => {
    worker();
    inject();
    click(root().querySelector("button[aria-label='RecipeHub Companion']"));
    await until(() => expect(item("Hide")).toBeTruthy());
    item("Hide").click();
    expect(host()).toBeNull();
    expect(window.__recipehubCompanion.present()).toBe(false);
  });

  it("can be dragged to another spot (a drag doesn't open the menu)", async () => {
    worker();
    inject();
    const button = root().querySelector("button[aria-label='RecipeHub Companion']");
    const before = host().style.top;
    pointer(button, "pointerdown", 1000, 300);
    pointer(window, "pointermove", 990, 200);
    pointer(window, "pointerup", 990, 200);
    button.click();
    expect(host().style.top).not.toBe(before);
    expect(root().querySelector("[role=menu]").hidden).toBe(true);
  });
});
