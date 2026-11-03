// Talking to Culury: the address and key from the settings, what's sent for a page or a note,
// and every answer turned into plain words. Used by the service worker (which does the fetching,
// so the popup and the on-page bubble share one path).

export const SOURCE_APP = "Culury Companion";

// "culury.example.com/#/recipes" -> "https://culury.example.com"; local names default to http
export function normalizeAddress(input) {
  let s = String(input ?? "").trim();
  if (!s) throw new Error("Enter your Culury address");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    const host = s.split(/[/:?#]/)[0];
    const local = host === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.endsWith(".local") || !host.includes(".");
    s = (local ? "http://" : "https://") + s;
  }
  let url;
  try {
    url = new URL(s);
  } catch {
    throw new Error("That isn't a web address");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Culury's address starts with http:// or https://");
  if (!url.hostname || /\s/.test(input.trim())) throw new Error("That isn't a web address");
  return url.origin;
}

const isWeb = (u) => typeof u === "string" && /^https?:\/\//i.test(u);
const metadataOf = (tab, at) => {
  const m = { pageTitle: tab.title || undefined, capturedAt: at };
  if (isWeb(tab.favIconUrl)) m.favIconUrl = tab.favIconUrl;
  return Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined));
};

// The page you're on. page.recipe: the recipe JSON-LD found in it, if any (Culury reads the
// recipe from that, even when the site later blocks Culury)
export function linkItem(tab, page = {}, at = new Date().toISOString()) {
  const host = (() => {
    try {
      return new URL(tab.url).hostname;
    } catch {
      return "";
    }
  })();
  const instagram = /(^|\.)instagram\.com$/i.test(host);
  const item = { type: instagram ? "INSTAGRAM_LINK" : page.recipe ? "RAW_RECIPE_DATA" : "RECIPE_LINK", url: tab.url, title: tab.title || undefined, sourceApp: SOURCE_APP, metadata: metadataOf(tab, at) };
  if (!instagram && page.recipe) item.content = page.recipe;
  return Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined));
}

// A quick note (typed, or the text you'd highlighted), with the page it was written on
export function noteItem(text, tab = {}, at = new Date().toISOString()) {
  const item = { type: "TEXT_NOTE", content: String(text).trim(), url: isWeb(tab.url) ? tab.url : undefined, sourceApp: SOURCE_APP, metadata: metadataOf(tab, at) };
  return Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined));
}

// ---------- requests ----------

async function call(settings, path, init, fetchFn) {
  let address;
  try {
    address = normalizeAddress(settings.address);
  } catch {
    return { problem: "Add your Culury address and API key in the extension's settings." };
  }
  if (!settings.key) return { problem: "Add your Culury address and API key in the extension's settings." };
  let res;
  try {
    res = await fetchFn(address + path, { ...init, headers: { ...(init.headers ?? {}), "x-api-key": settings.key } });
  } catch {
    return { problem: `Can't reach Culury at ${address}. Is it running, and is the address right?` };
  }
  const json = await res.json().catch(() => null);
  if (res.status === 401) return { problem: "Culury didn't recognize this API key. Check it in Settings › API keys." };
  if (res.status === 404 && path === "/api/key-check") return { problem: "This Culury is too old for the Companion: update Culury, then try again." };
  if (!res.ok) return { problem: json?.details?.[0]?.message ?? json?.error ?? `Culury answered ${res.status}` };
  return { status: res.status, json };
}

// Is the address right, is the key right, and what may the key do?
export async function checkConnection(settings, fetchFn = fetch) {
  const r = await call(settings, "/api/key-check", { method: "GET" }, fetchFn);
  if (r.problem) return { ok: false, problem: r.problem };
  if (r.json?.app !== "Culury") return { ok: false, problem: "That address answers, but it doesn't look like Culury. Check the address." };
  const { name, access, canPushToInbox, canImport, version } = r.json;
  return { ok: true, name, access, canPushToInbox, canImport, version };
}

// Send something to the inbox
export async function push(settings, item, fetchFn = fetch) {
  const r = await call(settings, "/api/inbox", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(item) }, fetchFn);
  if (r.problem) return { ok: false, problem: r.problem };
  return { ok: true, message: r.json?.duplicate ? "Already in your Culury inbox" : "Sent to your Culury inbox", id: r.json?.id };
}

export const ACCESS_LABELS = { read: "Read only", write: "Write only", recipe_push: "Recipe push", grocery_write: "Grocery list write", inbox_push: "Inbox only", admin: "Full admin" };
