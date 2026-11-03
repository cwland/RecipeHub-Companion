import { ACCESS_LABELS, linkItem, noteItem } from "../lib/culury.js";
import { readPage } from "../lib/page.js";

// The toolbar popup: is Culury connected, and send this page or a quick note to the inbox.
// Everything that talks to Culury goes through the service worker (background/handlers.js).

const $ = (id) => document.getElementById(id);
const ask = (msg) => chrome.runtime.sendMessage(msg);
const isWeb = (url) => /^https?:\/\//i.test(url ?? "");

// state: "ok", "problem" or "busy" (on its way: not shown as done)
function say(text, state = "ok") {
  const el = $("result");
  el.textContent = text;
  el.dataset.state = state === true ? "ok" : state === false ? "problem" : state;
}

export async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const web = isWeb(tab?.url);

  // What's on the page: highlighted text and the recipe it carries (web pages only)
  let page = {};
  if (web) {
    try {
      const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readPage });
      page = res?.result ?? {};
    } catch {
      page = {}; // some pages can't be read (the Web Store, PDFs): the link still goes
    }
  }

  $("page-title").textContent = tab?.title || tab?.url || "This tab";
  $("page-site").textContent = web ? new URL(tab.url).hostname.replace(/^www\./, "") : "";
  $("page-kind").textContent = !web ? "This isn't a web page: you can still send a note" : page.recipe ? "Recipe found on this page" : "";
  if (web && /^https?:\/\//.test(tab.favIconUrl ?? "")) {
    $("page-icon").src = tab.favIconUrl;
    $("page-icon").hidden = false;
  }
  if (page.selection) $("note").value = page.selection;

  $("settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
  $("open-inbox").addEventListener("click", () => void ask({ type: "open-inbox" })); // the popup closes as the tab opens

  const send = async (button, item, after) => {
    button.disabled = true;
    say("Sending…", "busy");
    const r = await ask({ type: "push", item });
    say(r.ok ? r.message : r.problem, r.ok);
    if (r.ok) after?.();
    button.disabled = false;
  };
  $("send").addEventListener("click", () => send($("send"), linkItem(tab, page)));
  $("send-note").addEventListener("click", () => {
    const text = $("note").value.trim();
    if (!text) return say("Write a note first", false);
    void send($("send-note"), noteItem(text, tab), () => ($("note").value = ""));
  });

  // Connected? (and can this key send to the inbox?)
  const c = await ask({ type: "check" });
  const status = $("status");
  if (!c.ok) {
    status.textContent = c.problem;
    status.dataset.state = "problem";
    return;
  }
  if (!c.canPushToInbox) {
    status.textContent = `This key (${ACCESS_LABELS[c.access] ?? c.access}) can't send to the inbox. Make an Inbox only key in Culury's Settings › API keys.`;
    status.dataset.state = "problem";
    return;
  }
  status.textContent = `Connected · ${c.name} (${ACCESS_LABELS[c.access] ?? c.access})`;
  status.dataset.state = "ok";
  $("send").disabled = !web;
  $("send-note").disabled = false;
}

if (globalThis.chrome?.runtime?.id) void init();
