// Culury's address and the API key, kept in this browser only (chrome.storage.local: never synced
// to your other devices)
const DEFAULTS = { address: "", key: "" };

export const loadSettings = (chrome = globalThis.chrome) => chrome.storage.local.get(DEFAULTS);
export const saveSettings = (settings, chrome = globalThis.chrome) => chrome.storage.local.set({ address: settings.address, key: settings.key });
