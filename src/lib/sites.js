import { normalizeAddress } from "./culury.js";

// "Always show on this site": the sites where the floating button appears by itself. Each needs the
// browser's OK to read that site (asked when it's added, given back when it's removed), and the
// button's script is registered to load there (chrome.scripting.registerContentScripts).

const SCRIPT_ID = "always-show";
const pattern = (site) => `${site}/*`;

// "https://www.seriouseats.com/chili?x=1" -> "https://www.seriouseats.com"; not a web page: null
export function siteOf(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

export async function listSites(chrome = globalThis.chrome) {
  return (await chrome.storage.local.get({ alwaysSites: [] })).alwaysSites;
}
const saveSites = (sites, chrome) => chrome.storage.local.set({ alwaysSites: [...new Set(sites)].sort((a, b) => a.replace(/^https?:\/\/(www\.)?/, "").localeCompare(b.replace(/^https?:\/\/(www\.)?/, ""))) });

// Ask the browser to read this site (must be called from a click), then add it
export async function addSite(site, chrome = globalThis.chrome) {
  const ok = await chrome.permissions.request({ origins: [pattern(site)] }).catch(() => false);
  if (!ok) return false;
  await saveSites([...(await listSites(chrome)), site], chrome);
  await syncSites(chrome);
  return true;
}

export async function removeSite(site, chrome = globalThis.chrome) {
  await saveSites((await listSites(chrome)).filter((s) => s !== site), chrome);
  // give the permission back, except for Culury's own address (needed to reach Culury)
  const { address } = await chrome.storage.local.get({ address: "" });
  let culury = null;
  try {
    culury = normalizeAddress(address);
  } catch {
    /* not set up */
  }
  if (site !== culury) await chrome.permissions.remove({ origins: [pattern(site)] }).catch(() => {});
  await syncSites(chrome);
}

// The registered script matches the list (and only sites the browser still lets the extension read)
export async function syncSites(chrome = globalThis.chrome) {
  const sites = await listSites(chrome);
  const allowed = [];
  for (const s of sites) if (await chrome.permissions.contains({ origins: [pattern(s)] }).catch(() => false)) allowed.push(s);
  if (allowed.length !== sites.length) await saveSites(allowed, chrome);
  const [old] = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (old) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  if (allowed.length)
    await chrome.scripting.registerContentScripts([{ id: SCRIPT_ID, matches: allowed.map(pattern), js: ["src/content/content_script.js"], runAt: "document_idle", persistAcrossSessions: true }]);
}
