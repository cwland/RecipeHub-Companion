import { checkConnection, importPage, linkItem, normalizeAddress, push } from "../lib/culury.js";
import { readPage } from "../lib/page.js";
import { loadSettings } from "../lib/settings.js";

// What the popup (and later the on-page bubble) asks the service worker to do. The worker does the
// talking to Culury: it has the permission to reach Culury's address, a web page doesn't.
//   { type: "check", settings? }  are the address and keys right? (settings: test these instead)
//                                 the import key's answer comes back as .import
//   { type: "push", item }        send to the inbox
//   { type: "import", page, improve }  import the page straight in (the Recipe push key)
//   { type: "open-inbox" }        open Culury's inbox in a new tab
// From the floating bubble on a page (sender.tab is that page's tab):
//   { type: "bubble-state" }      which of its actions work (keys set up, AI correction available)
//   { type: "bubble", action }    "push", "import" or "import-ai": the worker reads the page itself
export async function handle(msg, { chrome = globalThis.chrome, fetch = globalThis.fetch, sender } = {}) {
  const settings = msg.settings ?? (await loadSettings(chrome));
  switch (msg?.type) {
    case "check": {
      const [inbox, imp] = await Promise.all([checkConnection(settings, fetch), settings.importKey ? checkConnection({ ...settings, key: settings.importKey }, fetch) : null]);
      return { ...inbox, import: imp };
    }
    case "import":
      return importPage(settings, msg.page, !!msg.improve, fetch);
    case "push":
      return push(settings, msg.item, fetch);
    case "open-inbox": {
      try {
        await chrome.tabs.create({ url: `${normalizeAddress(settings.address)}/#/inbox` });
        return { ok: true };
      } catch {
        chrome.runtime.openOptionsPage();
        return { ok: false, problem: "Add your Culury address first" };
      }
    }
    case "bubble-state": {
      const [inbox, imp] = await Promise.all([checkConnection(settings, fetch), settings.importKey ? checkConnection({ ...settings, key: settings.importKey }, fetch) : null]);
      if (!inbox.ok) return { ok: false, problem: inbox.problem };
      const canImport = !!(imp?.ok && imp.canImport);
      return { ok: true, canPush: !!inbox.canPushToInbox, canImport, aiCorrection: canImport && !!imp.aiCorrection };
    }
    case "bubble": {
      const tab = sender?.tab;
      if (!tab?.id || !["push", "import", "import-ai"].includes(msg.action)) break;
      const page = await readTab(chrome, tab.id);
      if (msg.action === "push") return push(settings, linkItem(tab, page), fetch);
      return importPage(settings, pageToImport(tab, page), msg.action === "import-ai", fetch);
    }
  }
  return { ok: false, problem: "Unknown request" };
}

// The highlighted text, recipe data and HTML of a tab (the bubble's page). It can fail when the
// page has moved on since the bubble was put there: then just the link goes.
async function readTab(chrome, tabId) {
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: readPage });
    return res?.result ?? {};
  } catch {
    return {};
  }
}

// What an import sends: the page as you see it, except Instagram (Culury reads the post itself)
export function pageToImport(tab, page) {
  const instagram = /(^|\.)instagram\.com$/i.test(new URL(tab.url).hostname);
  return { url: tab.url, ...(page.html && !instagram ? { html: page.html } : {}) };
}
