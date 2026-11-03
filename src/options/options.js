import { ACCESS_LABELS, normalizeAddress } from "../lib/culury.js";
import { loadSettings, saveSettings } from "../lib/settings.js";

// The options page: Culury's address and the API key. Saved only once the test passes, so a
// typo never replaces settings that work.

const $ = (id) => document.getElementById(id);
// ok: true (done), false (a problem) or "busy" (testing: not shown as done)
function say(text, ok) {
  $("result").textContent = text;
  $("result").dataset.state = ok === "busy" ? "busy" : ok ? "ok" : "problem";
}

export async function init() {
  const saved = await loadSettings();
  $("address").value = saved.address;
  $("key").value = saved.key;

  document.querySelector("form").addEventListener("submit", (e) => {
    e.preventDefault();
    void save();
  });
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

  // Reaching Culury's address needs the browser's OK (asked for this one address only)
  const allowed = await chrome.permissions.request({ origins: [`${address}/*`] }).catch(() => false);
  if (!allowed) return say(`Allow the extension to reach ${address}, or it can't send anything to Culury.`, false);

  say("Testing…", "busy");
  const c = await chrome.runtime.sendMessage({ type: "check", settings: { address, key } });
  if (!c.ok) return say(c.problem, false);
  await saveSettings({ address, key });
  $("address").value = address;
  $("key").value = key;
  const can = c.canPushToInbox ? "" : " This key can't send to the inbox: make an Inbox only key in Culury's Settings › API keys.";
  say(`Connected to Culury ${c.version} as “${c.name}” (${ACCESS_LABELS[c.access] ?? c.access}). Saved.${can}`, c.canPushToInbox);
}

if (globalThis.chrome?.runtime?.id) void init();
