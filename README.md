# Culury Companion

A browser extension (Chrome, Brave, Edge and other Chromium browsers) that sends recipes, links and notes from the page you're on to your [Culury](https://github.com/cwland/Culury) inbox, to import when you're ready.

## Install

1. In Culury: **Settings › API keys** → name it `Culury Companion`, choose **Inbox only**, **Create key**, and copy the key (it's shown once).
2. Get this folder onto your computer (`git clone https://github.com/cwland/Culury-Companion.git`).
3. Open `brave://extensions` (or `chrome://extensions`), turn on **Developer mode**, click **Load unpacked**, and pick the `Culury-Companion` folder.
4. The settings open by themselves: enter the address you open Culury on (like `http://192.168.1.20:5173` or `https://culury.example.com`) and paste the key, then **Save and test**. The browser asks once to let the extension reach that address.

Pin it from the puzzle-piece menu so the icon stays in the toolbar.

To update: `git pull` in the folder, then the reload arrow on the extension's card in `brave://extensions`.

## Using it

Click the toolbar icon on any page:

- **Send to Inbox** sends the page. When the page carries its recipe for search engines (most recipe sites do), the recipe goes along, so Culury can read it even if the site blocks Culury later. Instagram posts go as Instagram links. The same page sent again while it's waiting isn't added twice.
- **Quick note** sends a note with the page's link. Highlight text on the page first and the note starts with it.
- **Open inbox** opens Culury's inbox; **Settings** changes the address or key.

In Culury, the inbox button (bottom of the left bar; in the Account menu on phones) shows what's waiting, with **Import** and **Dismiss**.

## Privacy and access

- The address and key are kept in this browser only (`chrome.storage.local`, not synced).
- The extension reaches only the Culury address you saved (asked when you save). It reads the page you're on only when you open the popup (`activeTab`): the highlighted text and the page's recipe data.
- An **Inbox only** key can send to the inbox and nothing else: it can't read your recipes or the inbox, or change anything.

## Develop

Plain JavaScript modules, no build step. Tests use Vitest with jsdom and a pretend browser (`tests/fakeChrome.js`):

```
npm install
npm test
```

- `src/lib/culury.js`: what's sent, and Culury's answers in plain words
- `src/lib/page.js`: runs in the page (highlighted text, recipe JSON-LD)
- `src/background/`: the service worker, which does all the talking to Culury
- `src/popup/`, `src/options/`: the popup and the settings page

Needs Culury with the inbox (`POST /api/inbox`, `GET /api/key-check`).
