// RecipeHub's address and the API keys, kept in this browser only (chrome.storage.local: never synced
// to your other devices). key: the Inbox only key. importKey: a Recipe push key for Direct Import
// (optional). improve: "Run through AI correction" was ticked last time.
const DEFAULTS = { address: "", key: "", importKey: "", improve: false };

export const loadSettings = (chrome = globalThis.chrome) => chrome.storage.local.get(DEFAULTS);
export const saveSettings = (settings, chrome = globalThis.chrome) => chrome.storage.local.set({ address: settings.address, key: settings.key, importKey: settings.importKey ?? "" });
export const saveImprove = (improve, chrome = globalThis.chrome) => chrome.storage.local.set({ improve: !!improve });
