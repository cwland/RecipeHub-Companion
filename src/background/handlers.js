import { checkConnection, importPage, linkItem, normalizeAddress, push } from "../lib/culury.js";
import { readPage } from "../lib/page.js";
import { showBanner } from "../lib/banner.js";
import { loadSettings } from "../lib/settings.js";
import { listSites, removeSite, siteOf } from "../lib/sites.js";

// What the popup (and later the on-page bubble) asks the service worker to do. The worker does the
// talking to Culury: it has the permission to reach Culury's address, a web page doesn't.
//   { type: "check", settings? }  are the address and keys right? (settings: test these instead)
//                                 the import key's answer comes back as .import
//   { type: "push", item }        send to the inbox
//   { type: "import", page, improve }  import the page straight in (the Recipe push key)
//   { type: "open-inbox" }        open Culury's inbox in a new tab
//   { type: "act", action, tab? } "push" or "import" for a page: the floating button's tab
//                                 (sender.tab), or the one the popup names; a banner on the page says how it went
//   { type: "bubble-state" }      what the floating button can do (keys set up; import with AI correction?;
//                                 always: this site is one where it shows by itself)
//   { type: "always-off" }        the floating button's "Stop showing on this site"
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
      const always = !!sender?.tab?.url && (await listSites(chrome)).includes(siteOf(sender.tab.url));
      return { ok: true, canPush: !!inbox.canPushToInbox, canImport, improve: canImport && !!settings.improve && !!imp.aiCorrection, always };
    }
    case "always-off": {
      // the floating button's "Stop showing on this site"
      const site = siteOf(sender?.tab?.url ?? "");
      if (!site) break;
      await removeSite(site, chrome);
      return { ok: true };
    }
    case "act": {
      // the popup names its tab (it closes straight away); the floating button: the tab it is on
      const tab = msg.tab ?? sender?.tab;
      if (!tab?.id || !["push", "import"].includes(msg.action)) break;
      return act(chrome, fetch, settings, tab, msg.action);
    }
  }
  return { ok: false, problem: "Unknown request" };
}

// Send to Inbox or Import, for a page: the worker reads it, does it, and says how it went in a
// banner at the top of the page. Import goes straight into Culury (and leaves a note in the inbox's
// Imported list), with AI correction when it's ticked and Culury can do it.
async function act(chrome, fetch, settings, tab, action) {
  // (what goes into the page must be JSON: null, never undefined)
  const banner = (text, state, link) => chrome.scripting.executeScript({ target: { tabId: tab.id }, func: showBanner, args: [text, state, link ?? null] }).catch(() => {});
  let improve = false;
  if (action === "import" && settings.improve && settings.importKey) improve = !!(await checkConnection({ ...settings, key: settings.importKey }, fetch)).aiCorrection;
  await banner(action === "push" ? "Sending to Culury…" : improve ? "Importing into Culury… then AI tidies it up" : "Importing into Culury…", "busy");
  const page = await readTab(chrome, tab.id);
  const r = action === "push" ? await push(settings, linkItem(tab, page), fetch) : await importPage(settings, pageToImport(tab, page), improve, fetch, { inbox: true });
  await banner(r.ok ? r.message : r.problem, r.ok ? "ok" : "problem", r.recipeUrl);
  return r;
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
