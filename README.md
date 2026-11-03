# Culury Companion

A browser extension (Chrome, Brave, Edge and other Chromium browsers) that sends recipes, links and notes from the page you're on to your [Culury](https://github.com/cwland/Culury) inbox, to import when you're ready.

## Install

1. In Culury: **Settings › API keys** → name it `Culury Companion`, choose **Inbox only**, **Create key**, and copy the key (it's shown once). For **Import to Culury**, make a second key, `Culury Companion import`, with **Recipe push** access.
2. Get this folder onto your computer (`git clone https://github.com/cwland/Culury-Companion.git`).
3. Open `brave://extensions` (or `chrome://extensions`), turn on **Developer mode**, click **Load unpacked**, and pick the `Culury-Companion` folder.
4. The settings open by themselves: enter the address you open Culury on (like `http://192.168.1.20:5173` or `https://culury.example.com`), paste the Inbox only key (and the Recipe push key, if you made one), then **Save and test**. Both keys are tested before anything is saved. The browser asks once to let the extension reach that address.

Pin it from the puzzle-piece menu so the icon stays in the toolbar.

To update: `git pull` in the folder, then the reload arrow on the extension's card in `brave://extensions`.

## Using it

Click the toolbar icon on any page:

- **Send to Inbox** sends the page. When the page carries its recipe for search engines (most recipe sites do), the recipe goes along, so Culury can read it even if the site blocks Culury later. Instagram posts go as Instagram links. The same page sent again while it's waiting isn't added twice.
- **Import to Culury** imports the page straight into your recipes (needs the Recipe push key), and leaves a note of it in the inbox's **Imported** tab (if the page was waiting in the inbox, that item moves there). The page goes as you see it, so sites that block Culury still work; Instagram goes by its link. Tick **Run through AI correction** to have Culury's AI tidy the recipe up in the background once it's in (a new version: the import stays as version 1). It's remembered, used by the floating button too, and can only be ticked when AI and Improve with AI are on in Culury's Settings › AI.
- The popup closes as you click, and a banner at the top of the page says how it went (with **Open the recipe** after an import), then fades out.
- **Floating button on this page** puts a small round Culury button on the page, with **📬 Send to Inbox**, **⚡ Import** (it says "with AI correction" when that's ticked) and **Hide**. Drag it anywhere; it sticks to the nearest side. It's only on that page: leaving the page or closing the tab takes it away, and other tabs never get it.
- **Open inbox** opens Culury's inbox; **Settings** changes the address or key.

In Culury, the inbox button (bottom of the left bar; in the Account menu on phones) shows what's waiting, with **Import** and **Dismiss**.

## Privacy and access

- The address and key are kept in this browser only (`chrome.storage.local`, not synced).
- The extension reaches only the Culury address you saved (asked when you save). It reads the page you're on only when you open the popup, or use its floating button (`activeTab`): the page's recipe data, and for an import the page itself. The banner at the top of the page is drawn in its own shadow root.
- An **Inbox only** key can send to the inbox and nothing else: it can't read your recipes or the inbox, or change anything. A **Recipe push** key can only send recipes in and follow its imports.

## Develop

Plain JavaScript modules, no build step. Tests use Vitest with jsdom and a pretend browser (`tests/fakeChrome.js`):

```
npm install
npm test
```

- `src/lib/culury.js`: what's sent, and Culury's answers in plain words
- `src/lib/page.js`, `src/lib/banner.js`: run in the page (recipe JSON-LD and the page's HTML; the banner)
- `src/background/`: the service worker, which does all the talking to Culury
- `src/popup/`, `src/options/`: the popup and the settings page
- `src/content/content_script.js`: the floating button, put on a page by the popup (only buttons: the service worker reads the page and talks to Culury, so no key reaches the page; its styles are in a shadow root, so the page can't change them and they can't change the page)

Needs Culury with the inbox (`POST /api/inbox`, `GET /api/key-check`) and `improve` on `POST /api/recipes/import`.
