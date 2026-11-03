import { checkConnection, normalizeAddress, push } from "../lib/culury.js";
import { loadSettings } from "../lib/settings.js";

// What the popup (and later the on-page bubble) asks the service worker to do. The worker does the
// talking to Culury: it has the permission to reach Culury's address, a web page doesn't.
//   { type: "check", settings? }  is the address and key right? (settings: test these instead)
//   { type: "push", item }        send to the inbox
//   { type: "open-inbox" }        open Culury's inbox in a new tab
export async function handle(msg, { chrome = globalThis.chrome, fetch = globalThis.fetch } = {}) {
  const settings = msg.settings ?? (await loadSettings(chrome));
  switch (msg?.type) {
    case "check":
      return checkConnection(settings, fetch);
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
    default:
      return { ok: false, problem: "Unknown request" };
  }
}
