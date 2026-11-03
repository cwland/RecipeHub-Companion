import { handle } from "./handlers.js";

// Answers the popup (and the on-page bubble): see handlers.js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // only from this extension's own pages and scripts
  if (sender.id !== chrome.runtime.id) return false;
  handle(msg, { sender }).then(sendResponse, (e) => sendResponse({ ok: false, problem: e?.message ?? "Something went wrong" }));
  return true; // answering later
});

// First install: open the settings so the address and key can be added
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") chrome.runtime.openOptionsPage();
});
