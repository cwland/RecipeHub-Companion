import { ACCESS_LABELS } from "../lib/culury.js";
import { readPage } from "../lib/page.js";
import { loadSettings, saveImprove } from "../lib/settings.js";
import { addSite, listSites, removeSite, siteOf } from "../lib/sites.js";

// Run in the page (the extension's isolated world, where the bubble keeps its handle)
function bubbleHere() {
  return !!window.__culuryCompanion?.present();
}
function hideBubble() {
  window.__culuryCompanion?.remove();
}

// The toolbar popup: is Culury connected; Send to Inbox or Import this page. Those go to the service
// worker (background/handlers.js), which does them and shows how it went in a banner at the top of
// the page, so the popup closes straight away.

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

  // Does the page carry its recipe? (web pages only)
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
  $("page-kind").textContent = !web ? "This isn't a web page: nothing to send from here" : page.recipe ? "Recipe found on this page" : "";
  if (web && /^https?:\/\//.test(tab.favIconUrl ?? "")) {
    $("page-icon").src = tab.favIconUrl;
    $("page-icon").hidden = false;
  }

  $("settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
  $("open-inbox").addEventListener("click", () => void ask({ type: "open-inbox" })); // the popup closes as the tab opens

  // Send or import: the worker does it (and shows how it went on the page); the popup closes
  const act = (action) => {
    void ask({ type: "act", action, tab: { id: tab.id, url: tab.url, title: tab.title, favIconUrl: tab.favIconUrl } });
    window.close();
  };
  $("send").addEventListener("click", () => act("push"));
  $("import").addEventListener("click", () => act("import"));

  // Run through AI correction: remembered (the worker reads it when importing)
  const saved = await loadSettings();
  $("improve").checked = !!saved.improve;
  $("improve").addEventListener("change", () => void saveImprove($("improve").checked));

  // The floating button on this page (web pages only), and "Always show on this site"
  if (web) {
    const run = (opts) => chrome.scripting.executeScript({ target: { tabId: tab.id }, ...opts });
    const putOn = () => run({ files: ["src/content/content_script.js"] });
    try {
      const [here] = await run({ func: bubbleHere });
      $("bubble").checked = !!here?.result;
      $("bubble").disabled = false;
      $("bubble").addEventListener("change", () => void ($("bubble").checked ? putOn() : run({ func: hideBubble })).catch(() => say("The button can't go on this page", false)));
    } catch {
      /* a page the extension can't touch (the Web Store, a PDF) */
    }
    const site = siteOf(tab.url);
    const name = new URL(site).hostname.replace(/^www\./, "");
    $("always-site").textContent = name;
    $("always").checked = (await listSites()).includes(site);
    $("always").disabled = $("bubble").disabled;
    $("always").addEventListener("change", async () => {
      if (!$("always").checked) return void (await removeSite(site));
      if (!(await addSite(site))) {
        $("always").checked = false;
        return say(`“Always show” needs your OK to read ${name}. Try again and choose Allow.`, false);
      }
      if (!$("bubble").checked) {
        $("bubble").checked = true;
        await putOn().catch(() => {});
      }
    });
  }

  // Connected? (and can these keys send to the inbox, and import?)
  const c = await ask({ type: "check" });
  showImport(c.import, web);
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
}

// The import part of the popup: ready, or what it needs
function showImport(imp, web) {
  const hint = $("import-hint");
  if (!imp) return void (hint.textContent = "Add a Recipe push key in Settings to import straight into Culury.");
  if (!imp.ok) return void (hint.textContent = imp.problem);
  if (!imp.canImport) return void (hint.textContent = `The import key (${ACCESS_LABELS[imp.access] ?? imp.access}) can't import: make a Recipe push key in Culury's Settings › API keys.`);
  $("import").disabled = !web;
  $("improve").disabled = !imp.aiCorrection;
  if (!imp.aiCorrection) {
    $("improve").checked = false;
    hint.textContent = "AI correction needs AI in Culury (Settings › AI, with Improve with AI on).";
  } else hint.textContent = "";
}

if (globalThis.chrome?.runtime?.id) void init();
