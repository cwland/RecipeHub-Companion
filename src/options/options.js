import { ACCESS_LABELS, normalizeAddress } from "../lib/recipehub.js";
import { loadSettings, saveSettings } from "../lib/settings.js";
import { listSites, removeSite } from "../lib/sites.js";

// The options page: RecipeHub's address and the API key. Saved only once the test passes, so a
// typo never replaces settings that work.

const $ = (id) => document.getElementById(id);
// ok: true (done), false (a problem) or "busy" (testing: not shown as done)
function say(text, ok) {
  $("result").textContent = text;
  $("result").dataset.state = ok === "busy" ? "busy" : ok ? "ok" : "problem";
}

const label = (access) => ACCESS_LABELS[access] ?? access;

export async function init() {
  const saved = await loadSettings();
  $("address").value = saved.address;
  $("key").value = saved.key;
  $("import-key").value = saved.importKey;

  await showSites();

  document.querySelector("form").addEventListener("submit", (e) => {
    e.preventDefault();
    void save();
  });
}

// The sites where the floating button appears by itself, each with Remove
async function showSites() {
  const sites = await listSites();
  const list = $("sites");
  list.replaceChildren(
    ...sites.map((site) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.className = "site";
      name.textContent = new URL(site).hostname.replace(/^www\./, "");
      name.title = site;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "secondary";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove ${name.textContent}`);
      remove.addEventListener("click", async () => {
        remove.disabled = true;
        await removeSite(site);
        await showSites();
      });
      li.append(name, remove);
      return li;
    })
  );
  $("sites-empty").hidden = sites.length > 0;
}

async function save() {
  let address;
  try {
    address = normalizeAddress($("address").value);
  } catch (e) {
    return say(e.message, false);
  }
  const key = $("key").value.trim();
  if (!key) return say("Paste your API key", false);

  // Reaching RecipeHub's address needs the browser's OK (asked for this one address only)
  const allowed = await chrome.permissions.request({ origins: [`${address}/*`] }).catch(() => false);
  if (!allowed) return say(`Allow the extension to reach ${address}, or it can't send anything to RecipeHub.`, false);

  const importKey = $("import-key").value.trim();

  say("Testing…", "busy");
  const c = await chrome.runtime.sendMessage({ type: "check", settings: { address, key, importKey } });
  if (!c.ok) return say(c.problem, false);
  const imp = c.import;
  if (imp && !imp.ok) return say(`The Direct Import key: ${imp.problem}`, false);
  if (imp && !imp.canImport) return say(`The Direct Import key (${label(imp.access)}) can't import: make a Recipe push key in RecipeHub's Settings › API keys.`, false);
  await saveSettings({ address, key, importKey });
  $("address").value = address;
  $("key").value = key;
  $("import-key").value = importKey;
  const can = c.canPushToInbox ? "" : " This key can't send to the inbox: make an Inbox only key in RecipeHub's Settings › API keys.";
  const direct = imp ? ` Direct Import: “${imp.name}” (${label(imp.access)})${imp.aiCorrection ? ", AI correction available" : ""}.` : "";
  say(`Connected to RecipeHub ${c.version} as “${c.name}” (${label(c.access)}).${direct} Saved.${can}`, c.canPushToInbox);
}

if (globalThis.chrome?.runtime?.id) void init();
