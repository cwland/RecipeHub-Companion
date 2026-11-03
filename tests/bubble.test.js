import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { until } from "./fakeChrome.js";

// The floating bubble, put on a page by the popup's switch (src/content/content_script.js runs in
// the page as a plain script). It asks the service worker for everything.
const code = fs.readFileSync("src/content/content_script.js", "utf8");
const inject = () => new Function(code)();
const host = () => document.getElementById("culury-companion-bubble");
const root = () => host().shadowRoot;
const item = (name) => [...root().querySelectorAll("[role=menuitem]")].find((b) => b.textContent.includes(name));

function worker(state = { ok: true, canPush: true, canImport: true, aiCorrection: true }, results = {}) {
  const sendMessage = vi.fn(async (msg) => (msg.type === "bubble-state" ? state : (results[msg.action] ?? { ok: true, message: "Sent to your Culury inbox" })));
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
  document.querySelectorAll("#culury-companion-bubble").forEach((b) => b.remove()); // it sits outside <body>
  document.body.innerHTML = "<h1>Pork Roast</h1>";
  delete window.__culuryCompanion;
});

describe("the floating bubble", () => {
  it("appears once, however many times it's switched on", async () => {
    worker();
    inject();
    inject();
    expect(document.querySelectorAll("#culury-companion-bubble")).toHaveLength(1);
    expect(root().querySelector("button[aria-label='Culury Companion']")).toBeTruthy();
    expect(window.__culuryCompanion.present()).toBe(true);
  });

  it("its menu: Push to Inbox, Import now, Import + AI clean-up, Hide", async () => {
    worker();
    inject();
    click(root().querySelector("button[aria-label='Culury Companion']"));
    await until(() => expect(root().querySelector("[role=menu]").hidden).toBe(false));
    await until(() => expect([...root().querySelectorAll("[role=menuitem]")].map((b) => b.textContent.trim())).toEqual(["📬 Push to Inbox", "⚡ Import now", "✨ Import + AI clean-up", "Hide"]));
  });

  it("Push to Inbox asks the worker, and says how it went", async () => {
    const send = worker();
    inject();
    click(root().querySelector("button[aria-label='Culury Companion']"));
    await until(() => expect(item("Push to Inbox").disabled).toBe(false));
    item("Push to Inbox").click();
    await until(() => expect(root().querySelector("[role=status]").textContent).toBe("Sent to your Culury inbox"));
    expect(send).toHaveBeenCalledWith({ type: "bubble", action: "push" });
  });

  it("an import links to the recipe", async () => {
    const send = worker(undefined, { "import-ai": { ok: true, message: "Imported “Pork Roast”. AI is tidying it up in the background.", recipeUrl: "http://192.168.86.222:5173/#/recipes/31" } });
    inject();
    click(root().querySelector("button[aria-label='Culury Companion']"));
    await until(() => expect(item("AI clean-up").disabled).toBe(false));
    item("AI clean-up").click();
    await until(() => expect(root().querySelector("[role=status]").textContent).toMatch(/Imported “Pork Roast”/));
    expect(root().querySelector("[role=status] a").href).toBe("http://192.168.86.222:5173/#/recipes/31");
    expect(send).toHaveBeenCalledWith({ type: "bubble", action: "import-ai" });
  });

  it("a problem shows as one", async () => {
    worker(undefined, { push: { ok: false, problem: "Can't reach Culury at http://192.168.86.222:5173. Is it running, and is the address right?" } });
    inject();
    click(root().querySelector("button[aria-label='Culury Companion']"));
    await until(() => expect(item("Push to Inbox").disabled).toBe(false));
    item("Push to Inbox").click();
    await until(() => expect(root().querySelector("[role=status]").dataset.state).toBe("problem"));
  });

  it("no import key: only Push; no AI in Culury: AI clean-up can't be picked, and says why", async () => {
    worker({ ok: true, canPush: true, canImport: false, aiCorrection: false });
    inject();
    click(root().querySelector("button[aria-label='Culury Companion']"));
    await until(() => expect(item("Push to Inbox").disabled).toBe(false));
    expect(item("Import now")).toBeUndefined();
    window.__culuryCompanion.remove();
    worker({ ok: true, canPush: true, canImport: true, aiCorrection: false });
    inject();
    click(root().querySelector("button[aria-label='Culury Companion']"));
    await until(() => expect(item("Import now").disabled).toBe(false));
    expect(item("AI clean-up").disabled).toBe(true);
    expect(item("AI clean-up").title).toMatch(/needs AI in Culury/);
  });

  it("not set up: the menu says so", async () => {
    worker({ ok: false, problem: "Add your Culury address and API key in the extension's settings." });
    inject();
    click(root().querySelector("button[aria-label='Culury Companion']"));
    await until(() => expect(root().querySelector("[role=menu]").textContent).toMatch(/Add your Culury address/));
  });

  it("Hide takes it off the page", async () => {
    worker();
    inject();
    click(root().querySelector("button[aria-label='Culury Companion']"));
    await until(() => expect(item("Hide")).toBeTruthy());
    item("Hide").click();
    expect(host()).toBeNull();
    expect(window.__culuryCompanion.present()).toBe(false);
  });

  it("can be dragged to another spot (a drag doesn't open the menu)", async () => {
    worker();
    inject();
    const button = root().querySelector("button[aria-label='Culury Companion']");
    const before = host().style.top;
    pointer(button, "pointerdown", 1000, 300);
    pointer(window, "pointermove", 990, 200);
    pointer(window, "pointerup", 990, 200);
    button.click();
    expect(host().style.top).not.toBe(before);
    expect(root().querySelector("[role=menu]").hidden).toBe(true);
  });
});
